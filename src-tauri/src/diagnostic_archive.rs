use std::fs::{self, OpenOptions};
use std::io::{Seek, Write};
use std::path::Path;

use uuid::Uuid;
use zip::ZipWriter;

pub(crate) fn write_diagnostic_bundle(
    destination: &Path,
    app_state: Option<&[u8]>,
    log_files: &[(String, Vec<u8>)],
    report: &str,
) -> Result<(), String> {
    let parent = destination.parent().ok_or("诊断包路径没有父目录")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = parent.join(format!(".diagnostic-bundle-{}.tmp", Uuid::new_v4()));
    let output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    let result = write_archive(output, app_state, log_files, report)
        .and_then(|_| replace_bundle_file(&temporary, destination));
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result
}

fn write_archive<W: Write + Seek>(
    output: W,
    app_state: Option<&[u8]>,
    log_files: &[(String, Vec<u8>)],
    report: &str,
) -> Result<(), String> {
    let mut archive = ZipWriter::new(output);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    write_archive_entry(&mut archive, "diagnostic-report.txt", report.as_bytes(), options)?;
    if let Some(contents) = app_state {
        write_archive_entry(&mut archive, "app-state.json", contents, options)?;
    }
    for (archive_path, contents) in log_files {
        write_archive_entry(&mut archive, archive_path, contents, options)?;
    }
    archive.finish().map_err(|error| error.to_string())?;
    Ok(())
}

fn write_archive_entry<W: Write + Seek>(
    archive: &mut ZipWriter<W>,
    archive_path: &str,
    contents: &[u8],
    options: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    archive.start_file(archive_path, options).map_err(|error| error.to_string())?;
    archive.write_all(contents).map_err(|error| error.to_string())
}

fn replace_bundle_file(temporary: &Path, destination: &Path) -> Result<(), String> {
    match fs::rename(temporary, destination) {
        Ok(()) => Ok(()),
        Err(error) if destination.exists() => {
            let backup = temporary.with_extension("previous");
            fs::rename(destination, &backup).map_err(|_| error.to_string())?;
            match fs::rename(temporary, destination) {
                Ok(()) => { let _ = fs::remove_file(backup); Ok(()) }
                Err(replace_error) => {
                    let _ = fs::rename(&backup, destination);
                    Err(replace_error.to_string())
                }
            }
        }
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::write_diagnostic_bundle;
    use std::fs::{self, File};
    use std::io::Read;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn bundle_contains_snapshot_files_and_replaces_destination() {
        let directory = temp();
        fs::create_dir_all(&directory).unwrap();
        let destination = directory.join("diagnostics.zip");
        write_diagnostic_bundle(&destination, Some(br#"{"version":1}"#), &[("logs/app.log".into(), b"log".to_vec())], "report").unwrap();
        write_diagnostic_bundle(&destination, Some(br#"{"version":2}"#), &[], "new report").unwrap();
        let mut archive = zip::ZipArchive::new(File::open(&destination).unwrap()).unwrap();
        let mut report = String::new();
        archive.by_name("diagnostic-report.txt").unwrap().read_to_string(&mut report).unwrap();
        assert_eq!(report, "new report");
        let mut state = String::new();
        archive.by_name("app-state.json").unwrap().read_to_string(&mut state).unwrap();
        assert_eq!(state, r#"{"version":2}"#);
        assert!(archive.by_name("logs/app.log").is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    fn temp() -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("stickyhomeworks2-archive-{nanos}"))
    }
}
