#![allow(non_snake_case)]

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::PathBuf;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

use crate::app_config::AppType;
use crate::commands::sync_support::{
    post_sync_warning_from_result, run_post_import_sync, success_payload_with_warning,
};
use crate::database::backup::BackupEntry;
use crate::database::Database;
use crate::error::AppError;
use crate::provider::Provider;
use crate::services::provider::ProviderService;
use crate::store::AppState;

// ─── File import/export ──────────────────────────────────────

/// 导出数据库为 SQL 备份
#[tauri::command]
pub async fn export_config_to_file(
    #[allow(non_snake_case)] filePath: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let target_path = PathBuf::from(&filePath);
        db.export_sql(&target_path)?;
        Ok::<_, AppError>(json!({
            "success": true,
            "message": "SQL exported successfully",
            "filePath": filePath
        }))
    })
    .await
    .map_err(|e| format!("导出配置失败: {e}"))?
    .map_err(|e: AppError| e.to_string())
}

/// 从 SQL 备份导入数据库
#[tauri::command]
pub async fn import_config_from_file(
    #[allow(non_snake_case)] filePath: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let db = state.db.clone();
    let db_for_sync = db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path_buf = PathBuf::from(&filePath);
        let backup_id = db.import_sql(&path_buf)?;
        let warning = post_sync_warning_from_result(Ok(run_post_import_sync(db_for_sync)));
        if let Some(msg) = warning.as_ref() {
            log::warn!("[Import] post-import sync warning: {msg}");
        }
        Ok::<_, AppError>(success_payload_with_warning(backup_id, warning))
    })
    .await
    .map_err(|e| format!("导入配置失败: {e}"))?
    .map_err(|e: AppError| e.to_string())
}

#[tauri::command]
pub async fn sync_current_providers_live(state: State<'_, AppState>) -> Result<Value, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let app_state = AppState::new(db);
        ProviderService::sync_current_to_live(&app_state)?;
        Ok::<_, AppError>(json!({
            "success": true,
            "message": "Live configuration synchronized"
        }))
    })
    .await
    .map_err(|e| format!("同步当前供应商失败: {e}"))?
    .map_err(|e: AppError| e.to_string())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeProvidersExportFile {
    schema_version: u32,
    app: String,
    exported_at: String,
    current_provider_id: Option<String>,
    providers: Vec<Provider>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeProvidersImportResult {
    success: bool,
    message: String,
    file_path: String,
    total: usize,
    imported: usize,
    updated: usize,
    skipped: usize,
}

fn parse_claude_providers_import(text: &str) -> Result<(Vec<Provider>, Option<String>), AppError> {
    let value: Value = serde_json::from_str(text)
        .map_err(|e| AppError::Config(format!("Claude providers JSON is invalid: {e}")))?;

    if value.is_array() {
        let providers: Vec<Provider> = serde_json::from_value(value)
            .map_err(|e| AppError::Config(format!("Invalid provider list: {e}")))?;
        return Ok((providers, None));
    }

    let Some(obj) = value.as_object() else {
        return Err(AppError::Config(
            "Claude providers JSON must be an object or an array".to_string(),
        ));
    };

    if let Some(app) = obj.get("app").and_then(|v| v.as_str()) {
        if app != AppType::Claude.as_str() {
            return Err(AppError::Config(format!(
                "Provider list app must be '{}', got '{}'",
                AppType::Claude.as_str(),
                app
            )));
        }
    }

    let current_provider_id = obj
        .get("currentProviderId")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(ToString::to_string);

    let Some(providers_value) = obj.get("providers") else {
        return Err(AppError::Config(
            "Claude providers JSON is missing 'providers'".to_string(),
        ));
    };

    let providers = if providers_value.is_array() {
        serde_json::from_value(providers_value.clone())
            .map_err(|e| AppError::Config(format!("Invalid provider list: {e}")))?
    } else if let Some(map) = providers_value.as_object() {
        map.values()
            .cloned()
            .map(serde_json::from_value)
            .collect::<Result<Vec<Provider>, _>>()
            .map_err(|e| AppError::Config(format!("Invalid provider map: {e}")))?
    } else {
        return Err(AppError::Config(
            "'providers' must be an array or object map".to_string(),
        ));
    };

    Ok((providers, current_provider_id))
}

fn validate_import_provider(provider: &Provider) -> Result<(), AppError> {
    if provider.id.trim().is_empty() {
        return Err(AppError::Config(
            "Provider id cannot be empty in import file".to_string(),
        ));
    }
    if provider.name.trim().is_empty() {
        return Err(AppError::Config(format!(
            "Provider '{}' name cannot be empty in import file",
            provider.id
        )));
    }
    if provider.settings_config.is_null() {
        return Err(AppError::Config(format!(
            "Provider '{}' settingsConfig cannot be null",
            provider.id
        )));
    }
    Ok(())
}

#[tauri::command]
pub async fn export_claude_providers_to_file(
    #[allow(non_snake_case)] filePath: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let providers = db
            .get_all_providers(AppType::Claude.as_str())?
            .into_values()
            .collect::<Vec<_>>();
        let current_provider_id =
            crate::settings::get_effective_current_provider(&db, &AppType::Claude)?;
        let payload = ClaudeProvidersExportFile {
            schema_version: 1,
            app: AppType::Claude.as_str().to_string(),
            exported_at: chrono::Utc::now().to_rfc3339(),
            current_provider_id,
            providers,
        };
        let text = serde_json::to_string_pretty(&payload)
            .map_err(|e| AppError::Config(format!("Serialize provider list failed: {e}")))?;
        std::fs::write(&filePath, text).map_err(|e| AppError::io(PathBuf::from(&filePath), e))?;
        Ok::<_, AppError>(json!({
            "success": true,
            "message": "Claude providers exported successfully",
            "filePath": filePath,
            "total": payload.providers.len(),
        }))
    })
    .await
    .map_err(|e| format!("导出 Claude 供应商列表失败: {e}"))?
    .map_err(|e: AppError| e.to_string())
}

#[tauri::command]
pub async fn import_claude_providers_from_file(
    #[allow(non_snake_case)] filePath: String,
    state: State<'_, AppState>,
) -> Result<ClaudeProvidersImportResult, String> {
    let db = state.db.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let text = std::fs::read_to_string(&filePath)
            .map_err(|e| AppError::io(PathBuf::from(&filePath), e))?;
        let (providers, exported_current_id) = parse_claude_providers_import(&text)?;
        let total = providers.len();
        let existing_ids = db.get_provider_ids(AppType::Claude.as_str())?;
        let existing_current =
            crate::settings::get_effective_current_provider(&db, &AppType::Claude)?;

        let mut seen = HashSet::new();
        let mut imported_ids = HashSet::new();
        let mut first_imported_id: Option<String> = None;
        let mut imported = 0usize;
        let mut updated = 0usize;
        let mut skipped = 0usize;

        for mut provider in providers {
            validate_import_provider(&provider)?;
            ProviderService::normalize_provider_if_claude_for_import(&mut provider);

            if !seen.insert(provider.id.clone()) {
                skipped += 1;
                continue;
            }

            if first_imported_id.is_none() {
                first_imported_id = Some(provider.id.clone());
            }
            imported_ids.insert(provider.id.clone());

            if existing_ids.contains(&provider.id) {
                updated += 1;
            } else {
                imported += 1;
            }
            db.save_provider(AppType::Claude.as_str(), &provider)?;
        }

        if existing_current.is_none() {
            let target_current = exported_current_id
                .filter(|id| imported_ids.contains(id))
                .or(first_imported_id);
            if let Some(id) = target_current {
                db.set_current_provider(AppType::Claude.as_str(), &id)?;
                crate::settings::set_current_provider(&AppType::Claude, Some(&id))?;
            }
        }

        Ok::<_, AppError>(ClaudeProvidersImportResult {
            success: true,
            message: "Claude providers imported successfully".to_string(),
            file_path: filePath,
            total,
            imported,
            updated,
            skipped,
        })
    })
    .await
    .map_err(|e| format!("导入 Claude 供应商列表失败: {e}"))?
    .map_err(|e: AppError| e.to_string())?;

    if let Err(e) = ProviderService::sync_current_provider_for_app(state.inner(), AppType::Claude) {
        log::warn!("Failed to sync Claude live config after provider list import: {e}");
    }

    Ok(result)
}

// ─── File dialogs ────────────────────────────────────────────

/// 保存文件对话框
#[tauri::command]
pub async fn save_file_dialog<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    #[allow(non_snake_case)] defaultName: String,
) -> Result<Option<String>, String> {
    let dialog = app.dialog();
    let result = dialog
        .file()
        .add_filter("SQL", &["sql"])
        .set_file_name(&defaultName)
        .blocking_save_file();

    Ok(result.map(|p| p.to_string()))
}

/// 打开文件对话框
#[tauri::command]
pub async fn open_file_dialog<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Option<String>, String> {
    let dialog = app.dialog();
    let result = dialog
        .file()
        .add_filter("SQL", &["sql"])
        .blocking_pick_file();

    Ok(result.map(|p| p.to_string()))
}

#[tauri::command]
pub async fn save_json_file_dialog<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    #[allow(non_snake_case)] defaultName: String,
) -> Result<Option<String>, String> {
    let dialog = app.dialog();
    let result = dialog
        .file()
        .add_filter("JSON", &["json"])
        .set_file_name(&defaultName)
        .blocking_save_file();

    Ok(result.map(|p| p.to_string()))
}

#[tauri::command]
pub async fn open_json_file_dialog<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Option<String>, String> {
    let dialog = app.dialog();
    let result = dialog
        .file()
        .add_filter("JSON", &["json"])
        .blocking_pick_file();

    Ok(result.map(|p| p.to_string()))
}

/// 打开 ZIP 文件选择对话框
#[tauri::command]
pub async fn open_zip_file_dialog<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Option<String>, String> {
    let dialog = app.dialog();
    let result = dialog
        .file()
        .add_filter("ZIP / Skill", &["zip", "skill"])
        .blocking_pick_file();

    Ok(result.map(|p| p.to_string()))
}

// ─── Database backup management ─────────────────────────────

/// Manually create a database backup
#[tauri::command]
pub async fn create_db_backup(state: State<'_, AppState>) -> Result<String, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || match db.backup_database_file()? {
        Some(path) => Ok(path
            .file_name()
            .map(|f| f.to_string_lossy().into_owned())
            .unwrap_or_default()),
        None => Err(AppError::Config(
            "Database file not found, backup skipped".to_string(),
        )),
    })
    .await
    .map_err(|e| format!("Backup failed: {e}"))?
    .map_err(|e: AppError| e.to_string())
}

/// List all database backup files
#[tauri::command]
pub fn list_db_backups() -> Result<Vec<BackupEntry>, String> {
    Database::list_backups().map_err(|e| e.to_string())
}

/// Restore database from a backup file
#[tauri::command]
pub async fn restore_db_backup(
    state: State<'_, AppState>,
    filename: String,
) -> Result<String, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || db.restore_from_backup(&filename))
        .await
        .map_err(|e| format!("Restore failed: {e}"))?
        .map_err(|e: AppError| e.to_string())
}

/// Rename a database backup file
#[tauri::command]
pub fn rename_db_backup(
    #[allow(non_snake_case)] oldFilename: String,
    #[allow(non_snake_case)] newName: String,
) -> Result<String, String> {
    Database::rename_backup(&oldFilename, &newName).map_err(|e| e.to_string())
}

/// Delete a database backup file
#[tauri::command]
pub fn delete_db_backup(filename: String) -> Result<(), String> {
    Database::delete_backup(&filename).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_claude_providers_import_accepts_wrapper_array() {
        let text = r#"{
          "schemaVersion": 1,
          "app": "claude",
          "currentProviderId": "p1",
          "providers": [
            {
              "id": "p1",
              "name": "Provider One",
              "settingsConfig": { "env": { "ANTHROPIC_BASE_URL": "https://example.com" } }
            }
          ]
        }"#;

        let (providers, current) = parse_claude_providers_import(text).unwrap();
        assert_eq!(current.as_deref(), Some("p1"));
        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0].id, "p1");
    }

    #[test]
    fn parse_claude_providers_import_accepts_provider_map() {
        let text = r#"{
          "providers": {
            "p1": {
              "id": "p1",
              "name": "Provider One",
              "settingsConfig": { "env": {} }
            }
          }
        }"#;

        let (providers, current) = parse_claude_providers_import(text).unwrap();
        assert!(current.is_none());
        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0].id, "p1");
    }
}
