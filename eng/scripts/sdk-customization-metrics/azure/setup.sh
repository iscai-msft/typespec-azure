#!/usr/bin/env bash
# One-time Azure setup for the hosted dashboard with human review. Safe to run again.
#
# Runs in bash (macOS, Linux, WSL or Git Bash on Windows).
# Needs: Azure CLI signed in (`az login --tenant <tenant>`) with Owner on the subscription or
# resource group, and GitHub CLI signed in (`gh auth login`) with admin on the repository.
#
#   REVIEWERS='you@microsoft.com,teammate@microsoft.com' ./setup.sh
#
# Optional settings (environment variables):
#   SUB, TENANT       subscription and its tenant (default: the TME test subscription)
#   RG, LOCATION      resource group and region (default: rg-sdk-customization-metrics, westus2)
#   REPO              GitHub repository (default: iscai-msft/typespec-azure)
#   AUTH_CLIENT_ID    app registration for reviewer sign-in; leave unset on the first run
#   AUTH_TENANT_ID    tenant reviewers sign in with (default: TENANT)
#
# What it does:
#   1. Creates the resource group.
#   2. Creates an identity for GitHub Actions with Contributor on that group only, trusted for
#      this repository's "sdk-metrics-azure" environment (OIDC: no secrets are stored).
#   3. Deploys main.bicep: App Service, Cosmos DB, and the app's access to the database.
#   4. Sets the repository variables the deploy and weekly workflows read.
#   5. Starts the deploy workflow, which builds and publishes the site.
set -euo pipefail

SUB=${SUB:-4d042dc6-fe17-4698-a23f-ec6a8d1e98f4}
TENANT=${TENANT:-70a036f6-8e4d-4615-bad6-149c02e7720d}
RG=${RG:-rg-sdk-customization-metrics}
LOCATION=${LOCATION:-westus2}
REPO=${REPO:-iscai-msft/typespec-azure}
BRANCH=sdk-customization-metrics
REVIEWERS=${REVIEWERS:?Set REVIEWERS to a comma-separated list of sign-in names, or *}
AUTH_CLIENT_ID=${AUTH_CLIENT_ID:-}
AUTH_TENANT_ID=${AUTH_TENANT_ID:-$TENANT}
IDENTITY=id-sdk-metrics-github
HERE=$(cd "$(dirname "$0")" && pwd)

step() { printf '\n== %s\n' "$*"; }

step "Subscription"
az account set --subscription "$SUB"
if [ "$(az account show --query tenantId -o tsv)" != "$TENANT" ]; then
  echo "Subscription $SUB is not in tenant $TENANT. Run: az login --tenant $TENANT" >&2
  exit 1
fi
az account show --query '{subscription:name, user:user.name}' -o table

step "Resource group $RG ($LOCATION)"
az group create --name "$RG" --location "$LOCATION" --query properties.provisioningState -o tsv

step "GitHub Actions identity"
az identity create --resource-group "$RG" --name "$IDENTITY" --query name -o tsv
CLIENT_ID=$(az identity show -g "$RG" -n "$IDENTITY" --query clientId -o tsv)
PRINCIPAL_ID=$(az identity show -g "$RG" -n "$IDENTITY" --query principalId -o tsv)
SCOPE=$(az group show --name "$RG" --query id -o tsv)
if [ "$(az role assignment list --assignee "$PRINCIPAL_ID" --scope "$SCOPE" --role Contributor --query 'length(@)' -o tsv)" = "0" ]; then
  # A new identity can take a minute to be visible to role assignments.
  for attempt in 1 2 3 4 5 6; do
    if az role assignment create --assignee-object-id "$PRINCIPAL_ID" \
      --assignee-principal-type ServicePrincipal --role Contributor --scope "$SCOPE" \
      --query roleDefinitionName -o tsv; then
      break
    fi
    [ "$attempt" = 6 ] && exit 1
    echo "Waiting for the identity to propagate…"
    sleep 20
  done
else
  echo "Contributor already assigned"
fi
SUBJECT="repo:$REPO:environment:sdk-metrics-azure"
if ! az identity federated-credential show -g "$RG" --identity-name "$IDENTITY" \
  --name github-sdk-metrics-azure >/dev/null 2>&1; then
  az identity federated-credential create -g "$RG" --identity-name "$IDENTITY" \
    --name github-sdk-metrics-azure --issuer https://token.actions.githubusercontent.com \
    --subject "$SUBJECT" --audiences api://AzureADTokenExchange --query subject -o tsv
else
  echo "Federated credential already exists ($SUBJECT)"
fi

step "Azure resources (main.bicep) — takes a few minutes"
az deployment group create --resource-group "$RG" --name sdk-customization-metrics \
  --template-file "$HERE/main.bicep" \
  --parameters reviewers="$REVIEWERS" authClientId="$AUTH_CLIENT_ID" authTenantId="$AUTH_TENANT_ID" \
  --query properties.provisioningState -o tsv
output() {
  az deployment group show --resource-group "$RG" --name sdk-customization-metrics \
    --query "properties.outputs.$1.value" -o tsv
}
SITE_URL=$(output siteUrl)
REDIRECT=$(output signInRedirectUri)
echo "Site: $SITE_URL"

step "Repository variables on $REPO"
set_var() { gh variable set "$1" --body "$2" --repo "$REPO" && echo "  $1"; }
set_var AZURE_CLIENT_ID "$CLIENT_ID"
set_var AZURE_TENANT_ID "$TENANT"
set_var AZURE_SUBSCRIPTION_ID "$SUB"
set_var SDK_METRICS_AZURE_RESOURCE_GROUP "$RG"
set_var SDK_METRICS_REVIEWERS "$REVIEWERS"
set_var SDK_METRICS_AZURE_ENABLED true
if [ -n "$AUTH_CLIENT_ID" ]; then
  set_var SDK_METRICS_AUTH_CLIENT_ID "$AUTH_CLIENT_ID"
  set_var SDK_METRICS_AUTH_TENANT_ID "$AUTH_TENANT_ID"
  # Only once sign-in works: the weekly job then applies reviews, and Pages links here.
  set_var SDK_METRICS_REVIEW_SITE "$SITE_URL"
fi

step "Deploying the site"
gh workflow run sdk-customization-metrics-azure.yml --repo "$REPO" --ref "$BRANCH"
echo "Follow it with: gh run watch --repo $REPO \$(gh run list --repo $REPO --workflow sdk-customization-metrics-azure.yml --limit 1 --json databaseId -q '.[0].databaseId')"

step "Done"
echo "Site: $SITE_URL/sdk-customization-metrics/"
if [ -z "$AUTH_CLIENT_ID" ]; then
  cat <<EOF

Sign-in is not set up yet, so the site is read-only. Next:
  1. Create an app registration in the tenant your reviewers sign in with:
       az ad app create --display-name "SDK customization metrics" \\
         --sign-in-audience AzureADMyOrg --enable-id-token-issuance true \\
         --web-redirect-uris "$REDIRECT" --query appId -o tsv
  2. Run this script again with AUTH_CLIENT_ID=<that appId> (and AUTH_TENANT_ID=<that tenant>
     if it is not $TENANT).
EOF
fi
