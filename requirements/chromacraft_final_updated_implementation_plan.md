# ChromaCraft AI — Final MVP Implementation Plan

## Goal Description

Build a complete, locally runnable MVP for **ChromaCraft AI** based on the supplied:
- BRD document
- HTML prototype/mockup

The product must include:
- A Next.js 15 (App Router) frontend that visually matches the provided HTML mockup.
- Backend route handlers in the same Next.js app providing the required REST endpoints.
- A PostgreSQL database with Prisma ORM and a full schema for users, projects, jobs, assets, prompts, and generation metadata.
- A BullMQ + Redis queue system driving Node.js orchestration workers.
- Python processing scripts for image generation, background removal, resizing, grid splitting, ZIP export, and video-generation placeholders.
- Docker Compose orchestration for all services (`web`, `worker`, `postgres`, `redis`) enabling `docker compose up` to start the whole system.
- Authentication via NextAuth (credentials/email-password).
- Full end-to-end UI flows:
  - auth
  - dashboard
  - job creation
  - upload
  - prompt builder
  - generation progress
  - QA review
  - job history
  - settings

The final repository must be ready to clone, run `docker compose up`, and use the UI to create a job and see the complete workflow.

---

# Engineering Philosophy

## Build:
- simple
- modular
- debuggable
- maintainable
- runnable

## Avoid:
- overengineering
- premature scalability
- unnecessary abstractions
- enterprise patterns

This is:
- MVP
- learning project
- hobby/internal product
- not enterprise software

---

# Final Architecture

```txt
Next.js Frontend + APIs
        ↓
BullMQ Queue (Node.js)
        ↓
Node Worker Orchestration
        ↓
Spawn Python Processing Scripts
        ↓
Local File Storage
        ↓
PostgreSQL + Prisma
```

---

# Architecture Responsibilities

## Node.js Owns:
- APIs
- authentication
- queue orchestration
- job lifecycle
- polling APIs
- database updates
- ZIP download endpoints

## Python Owns:
- AI image generation
- image processing
- background removal
- resizing
- grid splitting
- ZIP creation
- video placeholders

Keep responsibilities strictly separated.

---

# Critical Architecture Decisions

## DO NOT use:
- FastAPI APIs for workers
- Python BullMQ consumers
- Kubernetes
- Kafka
- Microservices
- CQRS
- Event sourcing
- LangChain
- Temporal
- Complex AI agent frameworks
- Distributed storage
- Enterprise DevOps tooling

Keep architecture SIMPLE.

---

# Final Tech Stack

| Area | Technology |
|---|---|
| Frontend | Next.js 15 |
| Language | TypeScript |
| Styling | TailwindCSS |
| UI Components | shadcn/ui |
| State | Zustand |
| Data Fetching | React Query |
| Backend | Next.js Route Handlers |
| Database | PostgreSQL |
| ORM | Prisma |
| Queue | BullMQ |
| Queue Backend | Redis |
| Image Processing | Python + Pillow |
| Background Removal | rembg |
| AI APIs | OpenAI / Stability |
| Video APIs | Runway/Kling placeholders |
| Auth | NextAuth |
| Storage | Local Filesystem |
| Deployment | Docker Compose |

---

# Monorepo Structure

```txt
root/
├── apps/
│   ├── web/
│   └── worker/
│
├── packages/
│   ├── db/
│   └── shared/
│
├── storage/
│   ├── uploads/
│   ├── generated/
│   ├── processed/
│   ├── exports/
│   ├── temp/
│   └── jobs/
│
├── docker-compose.yml
├── README.md
└── .env.example
```

---

# Local Storage Strategy

## IMPORTANT
DO NOT use:
- AWS S3
- Cloudinary
- external storage

All assets stored locally.

## Job-Based Storage Structure

```txt
/storage/jobs/{jobId}
```

Inside each job:

```txt
input/
generated/
processed/
final/
temp/
```

---

# Cleanup Requirements

Implement scheduled cleanup logic:
- remove temp files
- remove failed outputs
- remove stale ZIP exports
- configurable retention period

Default retention:
```txt
7 days
```

---

# Frontend Requirements

## CRITICAL RULE

The HTML prototype is the PRIMARY SOURCE OF TRUTH.

DO NOT:
- redesign UI
- modernize layout
- simplify screens
- replace with generic dashboard templates

Preserve:
- spacing
- colors
- typography
- animations
- card hierarchy
- navigation
- interaction patterns
- responsiveness

---

# Prototype Conversion Strategy

## Phase 1
Directly port HTML/CSS into reusable React components with minimal structural modifications.

## Phase 2
Gradually componentize repeated sections.

DO NOT prematurely optimize component architecture.

---

# DO NOT GENERATE

- placeholder dashboards
- generic SaaS templates
- fake cards
- simplified layouts

The generated UI must closely replicate the provided prototype.

---

# Pages To Implement

## Authentication
- Login
- Signup
- Forgot Password

## Main App
- Dashboard
- New Job Flow
- Upload Screen
- Prompt Builder
- Generation Workflow
- QA Review
- Job History
- Job Details
- User Profile/Settings

---

# Workflow Requirements

# UC1 — Car Color Variant Pipeline

## Flow

```txt
Upload Car
→ Create Job
→ Queue Task
→ Generate 12 Color Variants
→ Background Removal
→ Grid Split
→ Resize
→ Rename Files
→ QA Review
→ ZIP Export
```

## Required Color Variants

- white
- black
- blue
- red
- green
- brown
- silver
- yellow
- cream
- pink
- dark blue
- orange

## Output Requirements

Maintain:
- consistent pose
- consistent dimensions
- transparent PNG output

---

# UC2 — Scooter Lifestyle Pipeline

## Flow

```txt
Upload Scooter
→ Generate Lifestyle Images
→ Preserve Product Fidelity
→ Manual QA
→ Video Generation Trigger
→ ZIP Export
```

## Lifestyle Generation Requirements

Generate:
- contextual lifestyle compositions
- rider scenes
- marketing-style images

Provide placeholder integrations for:
- Runway
- Kling
- Pika

---

# Queue Architecture

## Queue Names

```txt
generation
processing
export
```

## Queue Requirements

Implement:
- retries
- concurrency limits
- progress updates
- graceful failures
- chunked processing

---

# Concurrency Protection

Prevent:
- memory exhaustion
- runaway batch jobs
- CPU spikes
- queue flooding

---

# Batch Chunking

Large jobs should be chunked into smaller processing batches.

Example:
```txt
1000 images → smaller batches
```

This improves:
- retries
- reliability
- recovery

---

# Polling Strategy

## IMPORTANT
DO NOT use WebSockets.

Use polling every:
```txt
3-5 seconds
```

Polling must automatically stop when:
- job completed
- job failed

---

# Job State System

Implement:

```txt
PENDING
PROCESSING
QA_PENDING
COMPLETED
FAILED
```

Store:
- progress
- timestamps
- prompts
- output paths
- generation metadata
- failure reasons

---

# Error Visibility

Expose worker/job failure reasons in the UI for debugging visibility.

This is critical for AI workflow debugging.

---

# Database Requirements

## Prisma Models

Create:

```txt
User
Project
Job
Asset
PromptTemplate
Generation
```

Include:
- enums
- timestamps
- relations
- statuses

Generate:
- migrations
- seed scripts

---

# Authentication Requirements

Use:
```txt
NextAuth
```

Implement:
- credentials auth
- protected routes
- session handling

Seed:
- default demo/admin user

---

# API Requirements

Implement working APIs:

```txt
POST /api/jobs
GET /api/jobs
GET /api/jobs/:id

POST /api/upload
POST /api/generate

POST /api/qa/approve
POST /api/qa/reject

POST /api/export
```

---

# Upload Safeguards

Implement:
- max upload size
- mime type validation
- upload error handling
- graceful failures

Prevent:
- crashes
- invalid uploads
- memory spikes

---

# Python Processing Strategy

## IMPORTANT

Python scripts should be executed by Node workers.

DO NOT make Python directly consume BullMQ.

## Correct Flow

```txt
BullMQ Worker (Node)
    ↓
Spawn Python Script
    ↓
Process Images
    ↓
Save Files
    ↓
Update DB
```

---

# Python Script Responsibilities

Create scripts for:
- image generation
- background removal
- grid splitting
- resizing
- ZIP creation
- video placeholders

---

# Development Mode

Support:

```env
DEVELOPMENT_MODE=true
```

When enabled:
- use mock AI outputs
- skip expensive APIs
- generate deterministic assets
- simulate queue progress

This is critical for rapid development.

---

# AI Workflow Reliability Requirements

The system must gracefully handle:
- AI API failures
- inconsistent outputs
- failed image processing
- partial batch failures
- retries
- corrupted files

Implement:
- retry handling
- graceful degradation
- queue recovery
- job failure visibility

---

# Docker Requirements

Provide COMPLETE docker-compose setup for:
- web
- postgres
- redis
- worker

Project must run using:

```bash
docker compose up
```

---

# Verification Requirements

## Manual Verification Focus

Prioritize:
- working workflows
- visual fidelity
- stable queue processing
- end-to-end functionality

Over:
- heavy automated testing
- enterprise CI pipelines

---

# Required Verification Flow

Verify:
1. User can login
2. Upload image
3. Create job
4. Queue processes successfully
5. Generated assets appear
6. QA flow works
7. ZIP export downloads correctly

---

# Code Quality Requirements

Requirements:
- strict TypeScript
- reusable components
- clean folder structure
- environment variable usage
- loading states
- empty states
- retry handling
- graceful failures

---

# Critical MVP Priorities

Focus heavily on:

1. Queue stability
2. File processing reliability
3. Prompt management
4. Product fidelity workflow
5. Batch processing
6. Debuggability
7. Prototype fidelity
8. Easy local setup
9. Clean workflow UX

---

# Final Deliverables

Generate:
- complete runnable codebase
- frontend
- backend
- queue system
- database schema
- Docker setup
- Prisma migrations
- Python scripts
- local storage system
- README
- environment configs
- reusable UI components

---

# Final Product Requirements

The final product must:
- run locally
- support complete workflows
- visually match prototype
- implement BRD requirements
- be easy to debug
- be maintainable by a small team
- support MVP-scale workloads
- avoid unnecessary complexity

---

# Final Engineering Principle

DO NOT optimize for hypothetical scale.

Optimize for:
- shipping fast
- debugging easily
- maintaining sanity
- preserving prototype fidelity
- making workflows actually work

