/*
 * @Author: lixiao
 * @Date: 2026-09-04 08:55:37
 * @LastEditors: Lixiao
 * @LastEditTime: 2026-09-04 08:58:54
 * @Description: Do not edit
 * @Email: 932184220@qq.com
 */
// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// 数据文件目录：<app_data>/schedule-data.json
fn data_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取数据目录: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建数据目录: {e}"))?;
    Ok(dir.join("schedule-data.json"))
}

/// 图片导出目录：<app_data>/exports/
fn export_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取数据目录: {e}"))?;
    let sub = dir.join("exports");
    fs::create_dir_all(&sub).map_err(|e| format!("无法创建导出目录: {e}"))?;
    Ok(sub)
}

/// 读取整包数据（JSON 字符串）。首次运行返回 null。
#[tauri::command]
fn load_data(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let p = data_path(&app)?;
    if !p.exists() {
        return Ok(None);
    }
    fs::read_to_string(&p)
        .map(Some)
        .map_err(|e| format!("读取数据失败: {e}"))
}

/// 覆盖写入整包数据。
#[tauri::command]
fn save_data(app: tauri::AppHandle, payload: String) -> Result<(), String> {
    let p = data_path(&app)?;
    fs::write(&p, payload).map_err(|e| format!("保存数据失败: {e}"))
}

/// 文件名消毒：只保留安全字符（含中文等 unicode 字母数字）
fn sanitize_file_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// 把排班图片（PNG 字节）写入导出目录，返回保存路径。
#[tauri::command]
fn export_image(
    app: tauri::AppHandle,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let p = export_dir(&app)?.join(sanitize_file_name(&file_name));
    fs::write(&p, bytes).map_err(|e| format!("写入图片失败: {e}"))?;
    Ok(p.to_string_lossy().into_owned())
}

/// 把文本（如成员 JSON）写入导出目录，返回保存路径。
#[tauri::command]
fn export_text(
    app: tauri::AppHandle,
    file_name: String,
    text: String,
) -> Result<String, String> {
    let p = export_dir(&app)?.join(sanitize_file_name(&file_name));
    fs::write(&p, text).map_err(|e| format!("写入文件失败: {e}"))?;
    Ok(p.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            export_image,
            export_text
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
