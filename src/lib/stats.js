// ============================================================================
// Migration Statistics
// ============================================================================

export class MigrationStats {
  constructor() {
    this.totalFiles = 0;
    this.processedFiles = 0;
    this.renamedFiles = 0;
    this.renamedDirs = 0;
    this.totalLinks = 0;
    this.namingConflicts = [];
    this.duplicates = 0;
    this.csvFilesProcessed = 0;
    this.csvIndexesCreated = 0;
    this.calloutsConverted = 0;
  }

  addNamingConflict(filePath, resolution) {
    this.namingConflicts.push({ filePath, resolution });
  }

  getSummary() {
    return {
      totalFiles: this.totalFiles,
      processedFiles: this.processedFiles,
      renamedFiles: this.renamedFiles,
      renamedDirs: this.renamedDirs,
      totalLinks: this.totalLinks,
      namingConflictCount: this.namingConflicts.length,
      duplicates: this.duplicates,
      csvFilesProcessed: this.csvFilesProcessed,
      csvIndexesCreated: this.csvIndexesCreated,
      calloutsConverted: this.calloutsConverted
    };
  }
}
