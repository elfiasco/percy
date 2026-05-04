#!/usr/bin/env python3
import os
import shutil
import tempfile
import uuid
from pathlib import Path


class WorkspaceTemporaryDirectory:
    def __init__(self, *args, **kwargs) -> None:
        self.name = str(Path(__file__).parent / ".tmp" / f"tmp-{uuid.uuid4().hex}")

    def __enter__(self) -> str:
        Path(self.name).mkdir(parents=True, exist_ok=False)
        return self.name

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        shutil.rmtree(self.name, ignore_errors=True)

    def cleanup(self) -> None:
        shutil.rmtree(self.name, ignore_errors=True)


if os.environ.get("PERCY_CDK_WORKSPACE_TEMP") == "1":
    # Windows sandbox temp directories are created without usable traversal ACLs here.
    tempfile.TemporaryDirectory = WorkspaceTemporaryDirectory

from aws_cdk import App

from percy_stack import PercyCloudDemoStack


app = App()
PercyCloudDemoStack(app, "PercyCloudDemoStack")
app.synth()
