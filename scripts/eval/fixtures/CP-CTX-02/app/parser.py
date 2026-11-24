"""解析 worker 日志行。"""


def parse_line(line: str) -> dict:
    parts = line.split()
    result = {}
    for part in parts:
        if "=" in part:
            key, _, value = part.partition("=")
            result[key] = value
    return result


def error_count(lines) -> int:
    count = 0
    for line in lines:
        if parse_line(line).get("level") == "ERROR":
            count += 1
    return count
