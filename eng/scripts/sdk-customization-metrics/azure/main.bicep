// Hosting for the SDK customization metrics dashboard with human review.
//
//   App Service (Linux, Node)  serves the published dashboard and /api/reviews
//     - built-in sign-in (Microsoft Entra ID) identifies reviewers
//     - system-assigned managed identity reads and writes Cosmos DB
//   Cosmos DB for NoSQL (serverless)  stores submitted reviews; key access disabled
//
// Deploy into an existing resource group:
//   az deployment group create -g <group> -f main.bicep -p reviewers='a@x.com,b@x.com' \
//     authClientId=<app registration client id> authTenantId=<tenant of the reviewers>
// The deploying identity needs Contributor on the group (no role-assignment rights are
// needed: Cosmos DB data access is granted with a Cosmos DB SQL role assignment).

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Short prefix for resource names (lowercase letters and digits).')
@minLength(3)
@maxLength(12)
param namePrefix string = 'sdkmetrics'

@description('Comma-separated sign-in names allowed to submit reviews, or * for anyone who signs in. Empty means nobody.')
param reviewers string = ''

@description('Client ID of the Microsoft Entra app registration used for sign-in. Empty leaves sign-in off (the site is read-only).')
param authClientId string = ''

@description('Tenant that reviewers sign in with.')
param authTenantId string = tenant().tenantId

@description('App Service Linux runtime.')
param linuxFxVersion string = 'NODE|22-lts'

@description('App Service plan size. B1 is the smallest that supports Always On.')
param planSku string = 'B1'

var suffix = uniqueString(resourceGroup().id, namePrefix)
var databaseName = 'sdkmetrics'
var containerName = 'reviews'
// Cosmos DB Built-in Data Contributor (data plane read/write).
var cosmosDataContributor = '00000000-0000-0000-0000-000000000002'

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: '${namePrefix}-${suffix}'
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    capabilities: [{ name: 'EnableServerless' }]
    locations: [{ locationName: location, failoverPriority: 0 }]
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    disableLocalAuth: true
    disableKeyBasedMetadataWriteAccess: true
    minimalTlsVersion: 'Tls12'
    publicNetworkAccess: 'Enabled'
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: cosmos
  name: databaseName
  properties: { resource: { id: databaseName } }
}

resource reviewsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: database
  name: containerName
  properties: {
    resource: {
      id: containerName
      partitionKey: { paths: ['/identity'], kind: 'Hash' }
    }
  }
}

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: '${namePrefix}-plan-${suffix}'
  location: location
  kind: 'linux'
  sku: { name: planSku }
  properties: { reserved: true }
}

resource site 'Microsoft.Web/sites@2024-04-01' = {
  name: '${namePrefix}-${suffix}'
  location: location
  kind: 'app,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: linuxFxVersion
      appCommandLine: 'node server.mjs'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      healthCheckPath: '/healthz'
      appSettings: [
        { name: 'COSMOS_ENDPOINT', value: cosmos.properties.documentEndpoint }
        { name: 'COSMOS_DATABASE', value: databaseName }
        { name: 'COSMOS_CONTAINER', value: containerName }
        { name: 'SDK_METRICS_REVIEWERS', value: reviewers }
        // The deployment is a prebuilt bundle; nothing to install on the server.
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
      ]
    }
  }
}

// Deployments use Microsoft Entra tokens (GitHub OIDC), never publishing passwords.
resource ftpCredentials 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-04-01' = {
  parent: site
  name: 'ftp'
  properties: { allow: false }
}

resource scmCredentials 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-04-01' = {
  parent: site
  name: 'scm'
  properties: { allow: false }
}

// Sign-in is optional for visitors (the dashboard is public); the API requires it to submit.
resource auth 'Microsoft.Web/sites/config@2024-04-01' = if (!empty(authClientId)) {
  parent: site
  name: 'authsettingsV2'
  properties: {
    platform: { enabled: true }
    globalValidation: {
      requireAuthentication: false
      unauthenticatedClientAction: 'AllowAnonymous'
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          openIdIssuer: '${environment().authentication.loginEndpoint}${authTenantId}/v2.0'
          clientId: authClientId
        }
        validation: { allowedAudiences: [authClientId, 'api://${authClientId}'] }
      }
    }
    login: { tokenStore: { enabled: true } }
  }
}

resource cosmosAccess 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-11-15' = {
  parent: cosmos
  name: guid(cosmos.id, site.id, cosmosDataContributor)
  properties: {
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/${cosmosDataContributor}'
    principalId: site.identity.principalId
    scope: cosmos.id
  }
}

output siteName string = site.name
output siteUrl string = 'https://${site.properties.defaultHostName}'
output signInRedirectUri string = 'https://${site.properties.defaultHostName}/.auth/login/aad/callback'
output cosmosAccount string = cosmos.name
