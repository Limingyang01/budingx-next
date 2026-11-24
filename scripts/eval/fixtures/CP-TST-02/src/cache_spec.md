# TTL 规格

`ttl_for(entry)`：

- 条目未过期：返回 `entry.ttl`。
- 条目已过期：返回 `0`。

示例：

- `Entry { ttl: 30, expired: false }` → `30`
- `Entry { ttl: 30, expired: true }` → `0`
