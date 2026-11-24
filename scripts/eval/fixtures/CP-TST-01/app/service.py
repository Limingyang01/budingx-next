from vendor.httpclient import get


def fetch_profile(user_id: int) -> dict:
    response = get("https://example.test/users/%d" % user_id)
    return response.json()
