"""Public re-export of the Studio HTTP wrapper.

This is the namespace generated brand modules import from. The actual class
lives in ``percy.agent.script_api`` — exposed here under a more user-facing
name so notebook users don't have to know about the agent internals.
"""

from percy.agent.script_api import Studio, StudioError, GroupHandle, SlideHandle, ElementHandle

__all__ = ["Studio", "StudioError", "GroupHandle", "SlideHandle", "ElementHandle"]
