"""Fetch the Percy API key from Secrets Manager and print it."""

import boto3

SECRET_ARN = "arn:aws:secretsmanager:us-east-1:242626139043:secret:PercyCloudDemoStack-PercyApiKeySecret"

def main():
    sm = boto3.client("secretsmanager", region_name="us-east-1")
    # The secret ARN prefix — list secrets to find the full name with suffix
    paginator = sm.get_paginator("list_secrets")
    for page in paginator.paginate():
        for s in page["SecretList"]:
            if "PercyApiKeySecret" in s["Name"]:
                resp = sm.get_secret_value(SecretId=s["ARN"])
                print(resp["SecretString"])
                return
    print("Secret not found — deploy may still be in progress")


if __name__ == "__main__":
    main()
