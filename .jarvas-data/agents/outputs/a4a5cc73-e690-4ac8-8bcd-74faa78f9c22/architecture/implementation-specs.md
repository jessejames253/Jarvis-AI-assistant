# Implementation Specifications

## File: src/models/notification.ts

```typescript
export enum DeliveryStatus {
  PENDING   = 'PENDING',
  DELIVERED = 'DELIVERED',
  READ      = 'READ',
  FAILED    = 'FAILED',
}

export interface Notification {
  id: string;          // UUID v4
  userId: string;      // UUID v4 FK
  type: string;        // ALERT | INFO | WARNING | SYSTEM
  message: string;     // notification body text
  status: DeliveryStatus;
  createdAt: Date;
  readAt: Date | null;
}

// ORM Entity (TypeORM example)
@Entity('notifications')
export class NotificationEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() userId: string;
  @Column({ length: 64 }) type: string;
  @Column('text') message: string;
  @Column({ type: 'enum', enum: DeliveryStatus, default: DeliveryStatus.PENDING }) status: DeliveryStatus;
  @CreateDateColumn() createdAt: Date;
  @Column({ nullable: true }) readAt: Date | null;
}
```

## File: migrations/20240101000000_create_notifications_table.ts

```typescript
export async function up(queryRunner) {
  await queryRunner.query(`
    CREATE TYPE delivery_status_enum AS ENUM ('PENDING','DELIVERED','READ','FAILED');
    CREATE TABLE notifications (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL,
      type       VARCHAR(64) NOT NULL,
      message    TEXT NOT NULL,
      status     delivery_status_enum NOT NULL DEFAULT 'PENDING',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      read_at    TIMESTAMPTZ
    );
    CREATE INDEX idx_notifications_user_id ON notifications(user_id);
    CREATE INDEX idx_notifications_status ON notifications(status);
    CREATE INDEX idx_notifications_user_status ON notifications(user_id, status);
  `);
}

export async function down(queryRunner) {
  await queryRunner.query(`
    DROP TABLE IF EXISTS notifications;
    DROP TYPE IF EXISTS delivery_status_enum;
  `);
}
```

## File: src/services/notificationService.ts

Key methods:

```typescript
class NotificationService {
  async createNotification(dto: CreateNotificationDto): Promise<Notification> {
    // 1. Insert row with status=PENDING
    // 2. Attempt pushToUser via gateway
    // 3. On success: markAsDelivered(id), on fail: markAsFailed(id)
    // 4. Return saved entity
  }

  async getNotificationsForUser(userId: string, page: number, limit: number, status?: DeliveryStatus) {
    // SELECT with WHERE userId=?, optional status filter, ORDER BY createdAt DESC, OFFSET/LIMIT
    // Return { data, total, page, limit }
  }

  async markAsRead(notificationId: string, userId: string): Promise<Notification> {
    // 1. Find by id, verify ownership (403 if mismatch)
    // 2. Atomically UPDATE status=READ, readAt=NOW() WHERE id=? AND userId=?
    // 3. Emit notification:read WebSocket event to userId
    // 4. Return updated entity
  }

  async markAsDelivered(notificationId: string): Promise<void> {
    // UPDATE status=DELIVERED WHERE id=? AND status=PENDING
  }

  async markAsFailed(notificationId: string): Promise<void> {
    // UPDATE status=FAILED WHERE id=? AND status=PENDING
  }
}
```

## File: src/controllers/notificationController.ts

```typescript
class NotificationController {
  async create(req, res) {
    // validate body, call service.createNotification, return 201
  }
  async list(req, res) {
    // validate query params, call service.getNotificationsForUser, return 200
  }
  async markRead(req, res) {
    // extract :id, req.user.id, call service.markAsRead, return 200
    // catch 404/403 and forward
  }
}
```

## File: src/websockets/notificationGateway.ts

```typescript
class NotificationGateway {
  private connections: Map<string, Set<WebSocket>> = new Map();

  handleConnection(ws: WebSocket, token: string): void {
    // verify JWT, extract userId, add to connections map
    // listen for subscribe/unsubscribe messages
    // on close: remove from map
  }

  pushToUser(userId: string, event: string, payload: unknown): boolean {
    // get all sockets for userId
    // send JSON.stringify({ event, payload }) to each OPEN socket
    // return true if at least one delivered
  }

  private removeSocket(userId: string, ws: WebSocket): void {
    // clean up connections map entry
  }
}
```

## File: src/hooks/useNotifications.ts

```typescript
function useNotifications(userId: string): UseNotificationsReturn {
  const { token } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(`${WS_BASE_URL}?token=${token}`);
    wsRef.current = ws;
    ws.onopen = () => {
      setIsConnected(true);
      ws.send(JSON.stringify({ event: 'subscribe', payload: { userId } }));
    };
    ws.onmessage = (e) => {
      const { event, payload } = JSON.parse(e.data);
      if (event === 'notification:new') {
        setNotifications(prev => [payload, ...prev]);
      } else if (event === 'notification:read') {
        setNotifications(prev => prev.map(n =>
          n.id === payload.id ? { ...n, status: 'READ', readAt: payload.readAt } : n
        ));
      }
    };
    ws.onclose = () => setIsConnected(false);
    return () => {
      ws.send(JSON.stringify({ event: 'unsubscribe', payload: { userId } }));
      ws.close();
    };
  }, [userId, token]);

  const markAsRead = async (notificationId: string) => {
    // optimistic update
    setNotifications(prev => prev.map(n =>
      n.id === notificationId ? { ...n, status: 'READ', readAt: new Date().toISOString() } : n
    ));
    await fetch(`/api/notifications/${notificationId}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
  };

  const unreadCount = notifications.filter(n => n.status !== 'READ').length;
  return { notifications, unreadCount, markAsRead, isConnected };
}
```
