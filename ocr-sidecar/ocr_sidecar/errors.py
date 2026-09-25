class SidecarError(Exception):
    """An expected error safe to serialize to a protocol client."""

    def __init__(self, code, message, details=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details


def unavailable(component, reason):
    return SidecarError(
        "sidecar_unavailable",
        f"{component} is unavailable",
        {"component": component, "reason": str(reason)},
    )
