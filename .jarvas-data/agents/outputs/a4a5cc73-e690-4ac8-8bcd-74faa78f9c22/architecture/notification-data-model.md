# Notification Data Model & API Contracts

## DeliveryStatus Enum

```
PENDING    - Notification created, not yet delivered to client
DELIVERED  - Notification pushed to client via WebSocket
READ       - User has acknowledged/read the notification
FAILED     - Delivery attempt failed (client not connected, timeout)
```

## Notification Entity Schema

| Field       | Type        | Nullable | Description                              |
|-------------|-------------|----------|------------------------------------------|
| id          | UUID (PK)   | No       | Auto-generated unique identifier         |
| userId      | UUID (FK)   | No       | Reference to owning user                 |
| type        | VARCHAR(64) | No       | Category: ALERT, INFO, WARNING, SYSTEM   |
| message     | TEXT        | No       | Human-readable notification body         |
| status      | ENUM        | No       | DeliveryStatus value, default PENDING    |
| createdAt   | TIMESTAMP   | No       | UTC creation time, auto-set              |
| readAt      | TIMESTAMP   | Yes      | UTC time user marked read, null until    |

## Database Indexes
- PRIMARY KEY on id
- INDEX idx_notifications_userId on (userId)
- INDEX idx_notifications_status on (status)
- INDEX idx_notifications_userId_status on (userId, status) — composite for list queries

## REST API Contracts

### POST /api/notifications
- Auth: Bearer token required
- Body: { userId, type, message }
- Response 201: { id, userId, type, message, status, createdAt, readAt }
- Response 400: { error: "Validation failed", details: [...] }

### GET /api/notifications
- Auth: Bearer token required
- Query: userId (required), page (default 1), limit (default 20), status (optional filter)
- Response 200: { data: Notification[], total: number, page: number, limit: number }

### PATCH /api/notifications/:id/read
- Auth: Bearer token required
- Response 200: { id, status: "READ", readAt }
- Response 404: { error: "Notification not found" }
- Response 403: { error: "Forbidden" }

## WebSocket Event Schema

### Client -> Server
```json
{ "event": "subscribe",   "payload": { "userId": "uuid" } }
{ "event": "unsubscribe", "payload": { "userId": "uuid" } }
```

### Server -> Client
```json
{ "event": "notification:new",   "payload": { ...NotificationObject } }
{ "event": "notification:read",  "payload": { "id": "uuid", "readAt": "ISO8601" } }
{ "event": "notification:error", "payload": { "message": "string", "code": number } }
```

## useNotifications Hook Interface

```typescript
interface UseNotificationsReturn {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (notificationId: string) => Promise<void>;
  isConnected: boolean;
}

function useNotifications(userId: string): UseNotificationsReturn
```

Hook responsibilities:
- Opens authenticated WebSocket on mount using token from AuthContext
- Sends subscribe event with userId
- Appends incoming notification:new events to local state
- Updates status/readAt on notification:read events
- Exposes unreadCount derived from notifications where status !== READ
- Calls REST PATCH on markAsRead, optimistically updates local state
- Tears down WebSocket and clears state on unmount
