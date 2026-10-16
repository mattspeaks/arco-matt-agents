// Idempotent DDL, run in order on every server start. Add new statements at the end; never edit applied ones.
export const SCHEMA: string[] = [
  `IF OBJECT_ID('dbo.stories') IS NULL CREATE TABLE dbo.stories (
     sys_id              CHAR(32)       NOT NULL PRIMARY KEY,
     number              NVARCHAR(40)   NOT NULL,
     short_description   NVARCHAR(400)  NULL,
     description         NVARCHAR(MAX)  NULL,
     acceptance_criteria NVARCHAR(MAX)  NULL,
     state_value         NVARCHAR(40)   NULL,
     state_label         NVARCHAR(100)  NULL,
     priority            NVARCHAR(100)  NULL,
     assigned_to         NVARCHAR(200)  NULL,
     sprint              NVARCHAR(200)  NULL,
     story_points        NVARCHAR(20)   NULL,
     tags                NVARCHAR(400)  NULL,
     domain              NVARCHAR(20)   NULL,
     on_board            BIT            NOT NULL DEFAULT 1,
     sn_updated_on       NVARCHAR(40)   NULL,
     synced_at           DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
   )`,
  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_stories_number')
     CREATE UNIQUE INDEX IX_stories_number ON dbo.stories(number)`,

  `IF OBJECT_ID('dbo.lanes') IS NULL CREATE TABLE dbo.lanes (
     value    NVARCHAR(40)  NOT NULL PRIMARY KEY,
     label    NVARCHAR(100) NOT NULL,
     sequence INT           NOT NULL
   )`,

  `IF OBJECT_ID('dbo.timesheets') IS NULL CREATE TABLE dbo.timesheets (
     sys_id         CHAR(32)      NOT NULL PRIMARY KEY,
     week_starts_on DATE          NOT NULL,
     week_ends_on   DATE          NULL,
     state          NVARCHAR(40)  NULL,
     total_hours    DECIMAL(6,2)  NULL,
     synced_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
   )`,

  `IF OBJECT_ID('dbo.time_cards') IS NULL CREATE TABLE dbo.time_cards (
     sys_id                 CHAR(32)      NOT NULL PRIMARY KEY,
     time_sheet_id          CHAR(32)      NOT NULL,
     task_number            NVARCHAR(40)  NULL,
     task_class             NVARCHAR(80)  NULL,
     task_short_description NVARCHAR(400) NULL,
     top_task_number        NVARCHAR(40)  NULL,
     category               NVARCHAR(100) NULL,
     sunday    DECIMAL(5,2) NULL, monday   DECIMAL(5,2) NULL, tuesday DECIMAL(5,2) NULL,
     wednesday DECIMAL(5,2) NULL, thursday DECIMAL(5,2) NULL, friday  DECIMAL(5,2) NULL,
     saturday  DECIMAL(5,2) NULL,
     total     DECIMAL(6,2) NULL,
     state     NVARCHAR(40) NULL,
     synced_at DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME()
   )`,

  `IF OBJECT_ID('dbo.runs') IS NULL CREATE TABLE dbo.runs (
     id              NVARCHAR(36)   NOT NULL PRIMARY KEY,
     kind            NVARCHAR(20)   NOT NULL,          -- sync | orchestrator | worker | sn_write
     worker          NVARCHAR(60)   NULL,
     story_number    NVARCHAR(40)   NULL,
     title           NVARCHAR(400)  NULL,
     status          NVARCHAR(30)   NOT NULL,          -- queued | awaiting_approval | running | succeeded | failed | cancelled
     parent_run_id   NVARCHAR(36)   NULL,
     conversation_id NVARCHAR(36)   NULL,
     session_id      NVARCHAR(60)   NULL,
     prompt          NVARCHAR(MAX)  NULL,
     result          NVARCHAR(MAX)  NULL,
     error           NVARCHAR(MAX)  NULL,
     meta            NVARCHAR(MAX)  NULL,
     cost_usd        DECIMAL(10,4)  NULL,
     created_at      DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
     started_at      DATETIME2      NULL,
     ended_at        DATETIME2      NULL
   )`,

  `IF OBJECT_ID('dbo.run_events') IS NULL CREATE TABLE dbo.run_events (
     id      BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
     run_id  NVARCHAR(36)   NOT NULL,
     ts      DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
     type    NVARCHAR(30)   NOT NULL,
     summary NVARCHAR(4000) NULL,
     data    NVARCHAR(MAX)  NULL
   )`,
  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_run_events_run')
     CREATE INDEX IX_run_events_run ON dbo.run_events(run_id, id)`,

  `IF OBJECT_ID('dbo.conversations') IS NULL CREATE TABLE dbo.conversations (
     id         NVARCHAR(36)  NOT NULL PRIMARY KEY,
     title      NVARCHAR(200) NOT NULL,
     session_id NVARCHAR(60)  NULL,
     created_at DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
     updated_at DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
   )`,

  `IF OBJECT_ID('dbo.chat_messages') IS NULL CREATE TABLE dbo.chat_messages (
     id              BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
     conversation_id NVARCHAR(36)  NOT NULL,
     role            NVARCHAR(20)  NOT NULL,          -- user | assistant | error
     content         NVARCHAR(MAX) NOT NULL,
     run_id          NVARCHAR(36)  NULL,
     created_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
   )`,

  `IF OBJECT_ID('dbo.approvals') IS NULL CREATE TABLE dbo.approvals (
     id                  NVARCHAR(36)   NOT NULL PRIMARY KEY,
     kind                NVARCHAR(30)   NOT NULL,      -- start_worker | sn_write | lesson
     title               NVARCHAR(400)  NOT NULL,
     payload             NVARCHAR(MAX)  NOT NULL,
     status              NVARCHAR(20)   NOT NULL,      -- pending | approved | rejected
     outcome             NVARCHAR(MAX)  NULL,
     requested_by_run_id NVARCHAR(36)   NULL,
     decision_note       NVARCHAR(MAX)  NULL,
     created_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
     decided_at          DATETIME2      NULL
   )`,

  `IF OBJECT_ID('dbo.lessons') IS NULL CREATE TABLE dbo.lessons (
     id           NVARCHAR(36)   NOT NULL PRIMARY KEY,
     lesson_code  NVARCHAR(30)   NULL,
     worker       NVARCHAR(60)   NOT NULL,
     rule_text    NVARCHAR(MAX)  NOT NULL,
     why          NVARCHAR(MAX)  NULL,
     applies_to   NVARCHAR(400)  NULL,
     source_story NVARCHAR(40)   NULL,
     status       NVARCHAR(20)   NOT NULL,           -- proposed | approved | rejected
     created_at   DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
   )`,

  // Story chats: a conversation dedicated to one story (NULL = the main chat).
  `IF COL_LENGTH('dbo.conversations', 'story_number') IS NULL ALTER TABLE dbo.conversations ADD story_number NVARCHAR(40) NULL`,

  // The Power BI report workflow per story (pbi/flow.ts): stage + JSON state.
  `IF OBJECT_ID('dbo.story_flows') IS NULL CREATE TABLE dbo.story_flows (
     story_number NVARCHAR(40)  NOT NULL PRIMARY KEY,
     stage        NVARCHAR(20)  NOT NULL,           -- pulling | building | review | revising | publishing | published | failed
     data         NVARCHAR(MAX) NOT NULL,
     created_at   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
     updated_at   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
   )`,
];
