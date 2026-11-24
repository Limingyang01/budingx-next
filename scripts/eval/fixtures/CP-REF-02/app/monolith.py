"""把所有报表逻辑堆在一起的模块。"""


def normalize(rows):
    result = []
    for row in rows:
        if not row:
            continue
        result.append({"name": row["name"].strip(), "amount": float(row["amount"])})
    return result


def summarize(rows):
    items = normalize(rows)
    return {"count": len(items), "total": sum(item["amount"] for item in items)}


def render(rows):
    summary = summarize(rows)
    return "count=%d total=%.2f" % (summary["count"], summary["total"])
