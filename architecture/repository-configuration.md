---
title: Repository Configuration
---

## Repository Configuration

Since we are doing a muli repository setup, we have to streamline orchestrating the multi repo setup.

The best way to do this is have a `gridx-workspace` repo that will have a root docker-compose.yml. This repo will orchestrate bundling and running the entire system.

### Workspace repo structure

This is the structure of the workspace repo:

```
gridx-workspace/
├── .gitignore
├── docker-compose.root.yml
├── Taskfile.yml
```

We are planning to go with go-task which is cross platform (works on windows, mac and linux).

The workspace will clone and pull the repository. Further setup regarding this is included in the readme of the [repo](https://github.com/p2p-energy-trading-platform/gridx-workspace)

### Core infra setup

The `gridx-infra` repo will have the core docker compose file that orchestrates and runs core services like mqtt, redis, apache kafka, etc.. It will also have scripts to seed system wide data and migrations for core database (only system wide databases).