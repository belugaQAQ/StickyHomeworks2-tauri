use std::io::{Cursor, Seek, Write};
use zip::ZipWriter;

pub(crate) fn create_diagnostic_bundle(
    app_state: Option<&[u8]>,
    log_files: &[(String, Vec<u8>)],
    report: &str,
) -> Result<Vec<u8>, String> {
    let output = Cursor::new(Vec::new());
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
    archive.finish().map(|output| output.into_inner()).map_err(|error| error.to_string())
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

#[cfg(test)]
mod tests {
    use super::create_diagnostic_bundle;
    use std::io::Read;

    #[test]
    fn bundle_contains_snapshot_files() {
        let bytes = create_diagnostic_bundle(Some(br#"{"version":1}"#), &[("logs/app.log".into(), b"log".to_vec())], "report").unwrap();
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let mut report = String::new();
        archive.by_name("diagnostic-report.txt").unwrap().read_to_string(&mut report).unwrap();
        assert_eq!(report, "report");
        assert!(archive.by_name("app-state.json").is_ok());
        assert!(archive.by_name("logs/app.log").is_ok());
    }
}

