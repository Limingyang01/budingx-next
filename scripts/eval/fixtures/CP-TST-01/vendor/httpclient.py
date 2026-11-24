class Response:
    """2.x 版本：响应体通过 payload() 取出。"""

    def __init__(self, body):
        self._body = body

    def payload(self):
        return self._body


def get(url):
    return Response({"url": url, "status": 200})
