# WP-202 Task/Resource Claim Evidence

Status: `DONE` on 2.7.16. Collector restart scheduling moved from raw `setTimeout` to bounded TaskSupervisor ownership. Resource claims are documented without inventing new conflicts; ModeCoordinator remains the atomic mode-claim owner and OperationManager owns GUI/inventory/movement/server-command operation conflicts.
