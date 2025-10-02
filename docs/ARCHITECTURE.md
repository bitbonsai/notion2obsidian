---
title: "ARCHITECTURE"
created: 2025-10-02
modified: 2025-10-02
tags: [docs]
folder: "docs"
published: false
---

# Architecture & Flow Diagrams

## System Architecture

```mermaid
flowchart TD
    A[User Interaction<br/>CLI Commands] --> B[Argument Parser]
    B --> C[Phase 1: Analysis]
    
    C --> D[File Scanner<br/>Glob]
    C --> E[Metadata Extractor]
    C --> F[File Map Builder]
    
    D --> G[Progress Bar]
    E --> H[Progress Bar]
    F --> I[Statistics]
    
    G --> J[Migration Preview]
    H --> J
    I --> J
    
    J --> K{Dry Run?}
    K -->|Yes| L[Exit]
    K -->|No| M{User Confirms?}
    M -->|No| L
    M -->|Yes| N[Phase 2: Migration]
    
    N --> O[Step 1: Process Content<br/>Batch Processing]
    O --> P[Step 2: Rename Files]
    P --> Q[Step 3: Rename Directories]
    Q --> R[Final Summary]
    
    style A fill:#e1f5ff
    style N fill:#fff4e1
    style R fill:#e8f5e9
    style L fill:#ffebee
```

## Data Flow Diagram

```mermaid
flowchart LR
    A["Input: Notion Export<br/>My Note abc123.md"] --> B[Analysis Phase]
    
    B --> C["Metadata Extraction<br/>- Notion ID<br/>- File Stats<br/>- Inline Metadata<br/>- Tags<br/>- Aliases"]
    
    C --> D["File Metadata<br/>{<br/>  title,<br/>  created,<br/>  modified,<br/>  tags,<br/>  aliases,<br/>  notion-id<br/>}"]
    
    D --> E[Processing Phase]
    
    E --> F["1. Create Backup<br/>2. Read Content<br/>3. Add Frontmatter<br/>4. Convert Links<br/>5. Write File"]
    
    F --> G[Renaming Phase]
    
    G --> H["Output: My Note.md<br/>with frontmatter<br/>and wiki links"]
    
    style A fill:#ffebee
    style H fill:#e8f5e9
    style E fill:#fff4e1
```

## Batch Processing Flow

```mermaid
flowchart TD
    A[Input: 1000 Files] --> B[Split into Batches]
    
    B --> C[Batch 1: Files 1-50]
    B --> D[Batch 2: Files 51-100]
    B --> E[Batch 3: Files 101-150]
    B --> F[...]
    B --> G[Batch 20: Files 951-1000]
    
    C --> H[Process in Parallel<br/>Promise.all]
    D --> I[Process in Parallel<br/>Promise.all]
    E --> J[Process in Parallel<br/>Promise.all]
    F --> K[...]
    G --> L[Process in Parallel<br/>Promise.all]
    
    H --> M[All Batches Complete]
    I --> M
    J --> M
    K --> M
    L --> M
    
    M --> N[1000 Files Processed]
    
    style A fill:#e1f5ff
    style N fill:#e8f5e9
```

## Component Interaction Diagram

```mermaid
graph TB
    A[CLI Parser<br/>parseArgs] --> B[Main Controller<br/>main]
    B --> C[Migration Stats]
    
    B --> D[File Scanner<br/>Glob.scan]
    B --> E[Directory Scanner<br/>getAllDirs]
    
    D --> F[buildFileMap]
    E --> F
    
    F --> G[Metadata Builder<br/>- getFileStats<br/>- extractMeta<br/>- getTagsFrom]
    
    G --> H[Preview Generator<br/>- showSamples<br/>- estimate]
    
    H --> I[User Prompt<br/>confirm]
    
    I -->|Dry Run| J[Exit]
    I -->|Confirmed| K[Batch Processor<br/>BATCH_SIZE=50]
    
    K --> L[processFile]
    K --> M[copyFile<br/>backup]
    K --> N[convertLinks]
    
    L --> O[Rename Phase<br/>- Files<br/>- Dirs]
    M --> O
    N --> O
    
    O --> P[Final Summary]
    
    C -.-> P
    
    style A fill:#e1f5ff
    style P fill:#e8f5e9
    style J fill:#ffebee
```

## Error Handling Flow

```mermaid
flowchart TD
    A[Operation Attempt] --> B{Try Block}
    
    B -->|Success| C[Return Success Object<br/>{success: true, data}]
    B -->|Error| D[Catch Block]
    
    D --> E[Log Error]
    E --> F[Add to Error List]
    F --> G[Return Error Object<br/>{success: false, error}]
    
    C --> H[Continue with<br/>Next Operation]
    G --> H
    
    H --> I{More Operations?}
    I -->|Yes| A
    I -->|No| J[Show Error Summary]
    
    style C fill:#e8f5e9
    style G fill:#ffebee
    style J fill:#fff4e1
```

## Performance Optimization Comparison

```mermaid
graph LR
    subgraph Original["Original Approach (Sequential)"]
        A1[F1] --> A2[F2]
        A2 --> A3[F3]
        A3 --> A4[F4]
        A4 --> A5[...]
        A5 --> A6[Fn]
    end
    
    subgraph Optimized["Optimized Approach (Batched)"]
        direction TB
        B1["Batch 1 (Parallel)<br/>Files 1-50"] --> B2["Batch 2 (Parallel)<br/>Files 51-100"]
        B2 --> B3["Batch 3 (Parallel)<br/>Files 101-150"]
        B3 --> B4[...]
    end
    
    Original -.->|"2n reads<br/>Sequential<br/>~45s"| X[" "]
    Optimized -.->|"n reads<br/>Parallel batches<br/>~23s (2x faster)"| Y[" "]
    
    style Original fill:#ffebee
    style Optimized fill:#e8f5e9
```

## Memory Management

```mermaid
graph TD
    A[Memory Allocation] --> B[File Map<br/>~10MB<br/>O1 lookups]
    A --> C[Migration Maps<br/>~20MB<br/>File metadata]
    A --> D[Batch Processing<br/>~30MB temporary<br/>50 files at time]
    A --> E[Statistics<br/>~5MB<br/>Error tracking]
    A --> F[Overhead<br/>~10MB]
    
    B --> G[Total Peak: ~75MB]
    C --> G
    D --> G
    E --> G
    F --> G
    
    G --> H[vs Original: ~100MB<br/>25% reduction]
    
    style G fill:#e8f5e9
    style H fill:#fff4e1
```

## Link Conversion Process

```mermaid
flowchart TD
    A["Input: [Link Text](My%20File%20abc123.md#section)"] --> B[Parse Markdown Link<br/>Regex Match]
    
    B --> C[Extract Components<br/>linkText: 'Link Text'<br/>linkPath: 'My%20File%20abc123.md#section']
    
    C --> D[Split Anchor<br/>path: 'My%20File%20abc123.md'<br/>anchor: 'section']
    
    D --> E[Decode URL<br/>path: 'My File abc123.md']
    
    E --> F[Clean Filename<br/>'My File abc123.md' → 'My File']
    
    F --> G{Alias Needed?}
    
    G -->|linkText ≠ filename| H[Build Aliased Link<br/>'[[My File#section|Link Text]]']
    G -->|linkText = filename| I[Build Simple Link<br/>'[[My File#section]]']
    
    H --> J[Output: Wiki Link]
    I --> J
    
    style A fill:#e1f5ff
    style J fill:#e8f5e9
```

## Statistics Tracking Flow

```mermaid
stateDiagram-v2
    [*] --> Initialize: Create MigrationStats
    
    Initialize --> Processing: Start Migration
    
    state Processing {
        [*] --> CountFiles
        CountFiles --> ProcessFile
        ProcessFile --> CountLinks
        CountLinks --> TrackErrors
        TrackErrors --> ProcessFile: Next file
        CountLinks --> [*]: Done
    }
    
    Processing --> Summary: Complete
    
    state Summary {
        [*] --> GetSummary
        GetSummary --> DisplayResults
        DisplayResults --> [*]
    }
    
    Summary --> [*]
```

## Migration Pipeline

```mermaid
flowchart LR
    A[Notion Export] --> B[Scan Files]
    B --> C[Extract Metadata]
    C --> D[Build File Map]
    D --> E[Generate Preview]
    E --> F{User Approval}
    F -->|Approve| G[Create Backups]
    F -->|Reject| Z[Exit]
    G --> H[Add Frontmatter]
    H --> I[Convert Links]
    I --> J[Rename Files]
    J --> K[Rename Directories]
    K --> L[Obsidian Vault]
    
    style A fill:#e1f5ff
    style L fill:#e8f5e9
    style Z fill:#ffebee
```

## Phase Breakdown

```mermaid
gantt
    title Migration Timeline (1000 files)
    dateFormat ss
    axisFormat %S sec
    
    section Phase 1
    File Scanning           :a1, 00, 5s
    Metadata Extraction     :a2, after a1, 8s
    Preview Generation      :a3, after a2, 2s
    
    section User
    Review & Confirm        :a4, after a3, 5s
    
    section Phase 2
    Content Processing      :b1, after a4, 15s
    File Renaming          :b2, after b1, 3s
    Directory Renaming     :b3, after b2, 2s
    
    section Complete
    Summary Display        :c1, after b3, 1s
```

## State Machine: File Processing

```mermaid
stateDiagram-v2
    [*] --> Pending: File discovered
    
    Pending --> Analyzing: Extract metadata
    Analyzing --> Previewed: Add to preview
    
    Previewed --> Queued: User confirmed
    Previewed --> Skipped: Dry run mode
    
    Queued --> Processing: Start processing
    Processing --> BackupCreated: Create backup
    BackupCreated --> ContentRead: Read file
    ContentRead --> FrontmatterAdded: Add frontmatter
    FrontmatterAdded --> LinksConverted: Convert links
    LinksConverted --> Written: Write file
    Written --> Renaming: Rename file
    Renaming --> Complete: Success
    
    Processing --> Error: Exception
    BackupCreated --> Error: Exception
    ContentRead --> Error: Exception
    Written --> Error: Exception
    Renaming --> Error: Exception
    
    Error --> Logged: Log error
    Logged --> NextFile: Continue
    Complete --> [*]
    Skipped --> [*]
    NextFile --> [*]
```

## Dependency Graph

```mermaid
graph TD
    A[migrate-notion-optimized.js] --> B[Bun Runtime]
    A --> C[chalk]
    A --> D[cli-progress]
    
    A --> E[fs/promises]
    A --> F[path]
    A --> G[Glob from bun]
    
    C --> H[Terminal Colors]
    D --> I[Progress Bars]
    E --> J[File Operations]
    F --> K[Path Utilities]
    G --> L[File Pattern Matching]
    
    style A fill:#e1f5ff
    style B fill:#fff4e1
```

## Data Structure: File Migration Map

```mermaid
classDiagram
    class FileMigrationMap {
        +String oldPath
        +String newPath
        +String oldName
        +String newName
        +Metadata metadata
        +Boolean needsRename
    }
    
    class Metadata {
        +String title
        +String created
        +String modified
        +Array~String~ tags
        +Array~String~ aliases
        +String notionId
        +String folder
        +String status
        +String owner
        +String dates
        +String priority
        +Number completion
        +String summary
    }
    
    class MigrationStats {
        +Number totalFiles
        +Number processedFiles
        +Number renamedFiles
        +Number renamedDirs
        +Number totalLinks
        +Array~Error~ errors
        +Number duplicates
        +addError(filePath, error)
        +getSummary()
    }
    
    FileMigrationMap --> Metadata
    FileMigrationMap --> MigrationStats
```

## Process Flow: Complete Migration

```mermaid
sequenceDiagram
    actor User
    participant CLI
    participant Scanner
    participant Processor
    participant FileSystem
    participant Progress
    
    User->>CLI: Run command
    CLI->>CLI: Parse arguments
    CLI->>Scanner: Scan directory
    
    loop For each file
        Scanner->>FileSystem: Read metadata
        FileSystem-->>Scanner: Return stats
        Scanner->>Progress: Update bar
    end
    
    Scanner-->>CLI: File list + metadata
    CLI->>User: Show preview
    User->>CLI: Confirm (Enter)
    
    CLI->>Processor: Start migration
    
    loop Batch processing
        Processor->>FileSystem: Create backup
        Processor->>FileSystem: Read content
        Processor->>Processor: Add frontmatter
        Processor->>Processor: Convert links
        Processor->>FileSystem: Write file
        Processor->>Progress: Update bar
    end
    
    loop Rename files
        Processor->>FileSystem: Rename file
        Processor->>Progress: Update bar
    end
    
    loop Rename directories
        Processor->>FileSystem: Rename directory
        Processor->>Progress: Update bar
    end
    
    Processor-->>CLI: Statistics
    CLI->>User: Show summary
```

---

All diagrams are now in Mermaid format! 🎨
