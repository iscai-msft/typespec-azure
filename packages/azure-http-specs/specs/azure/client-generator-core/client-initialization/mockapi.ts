import { json, passOnSuccess, ScenarioMockApi } from "@typespec/spec-api";

export const Scenarios: Record<string, ScenarioMockApi> = {};

// Mock responses for HeaderParam scenario
Scenarios._Specs__Azure_ClientGenerator_Core_ClientInitialization_HeaderParam = passOnSuccess([
  {
    uri: "/azure/client-generator-core/client-initialization/header-param/operation1",
    method: "get",
    request: {
      query: {
        id: "test-id"
      },
      headers: {
        "api-key": "test-api-key"
      }
    },
    response: {
      status: 200,
      body: json("Success with API key authentication")
    },
    kind: "MockApiDefinition",
  },
  {
    uri: "/azure/client-generator-core/client-initialization/header-param/operation2",
    method: "post",
    request: {
      headers: {
        "api-key": "test-api-key"
      },
      body: json({
        name: "test-name"
      })
    },
    response: {
      status: 200,
      body: json("Success with API key authentication")
    },
    kind: "MockApiDefinition",
  }
]);

// Mock responses for MultipleParams scenario
Scenarios._Specs__Azure_ClientGenerator_Core_ClientInitialization_MultipleParams = passOnSuccess([
  {
    uri: "/azure/client-generator-core/client-initialization/multiple-params/operation1",
    method: "get",
    request: {
      query: {
        id: "test-id",
        region: "us-west"
      },
      headers: {
        "api-key": "test-api-key"
      }
    },
    response: {
      status: 200,
      body: json("Success with API key and region parameters")
    },
    kind: "MockApiDefinition",
  },
  {
    uri: "/azure/client-generator-core/client-initialization/multiple-params/operation2",
    method: "post",
    request: {
      query: {
        region: "us-west"
      },
      headers: {
        "api-key": "test-api-key"
      },
      body: json({
        name: "test-name"
      })
    },
    response: {
      status: 200,
      body: json("Success with API key and region parameters")
    },
    kind: "MockApiDefinition",
  }
]);

// Mock responses for MixedParams scenario
Scenarios._Specs__Azure_ClientGenerator_Core_ClientInitialization_MixedParams = passOnSuccess([
  {
    uri: "/azure/client-generator-core/client-initialization/mixed-params/operation1",
    method: "get",
    request: {
      query: {
        id: "test-id",
        region: "us-west",
        "api-version": "2023-01-01"
      },
      headers: {
        "api-key": "test-api-key"
      }
    },
    response: {
      status: 200,
      body: json("Success with mixed client and method parameters")
    },
    kind: "MockApiDefinition",
  },
  {
    uri: "/azure/client-generator-core/client-initialization/mixed-params/operation2",
    method: "post",
    request: {
      query: {
        "api-version": "2023-01-01"
      },
      headers: {
        "api-key": "test-api-key"
      },
      body: json({
        name: "test-name"
      })
    },
    response: {
      status: 200,
      body: json("Success with mixed client and method parameters")
    },
    kind: "MockApiDefinition",
  }
]);

// Mock responses for SpreadModel scenario
Scenarios._Specs__Azure_ClientGenerator_Core_ClientInitialization_SpreadModel = passOnSuccess([
  {
    uri: "/azure/client-generator-core/client-initialization/spread-model/operation1",
    method: "get",
    request: {
      query: {
        id: "test-id"
      },
      headers: {
        "client-name": "test-client",
        "correlation-id": "123456"
      }
    },
    response: {
      status: 200,
      body: json("Success with spread model parameters")
    },
    kind: "MockApiDefinition",
  },
  {
    uri: "/azure/client-generator-core/client-initialization/spread-model/operation2",
    method: "post",
    request: {
      headers: {
        "client-name": "test-client",
        "correlation-id": "123456"
      },
      body: json({
        name: "test-name"
      })
    },
    response: {
      status: 200,
      body: json("Success with spread model parameters")
    },
    kind: "MockApiDefinition",
  }
]);

// Mock responses for BlobOperations scenario
Scenarios._Specs__Azure_ClientGenerator_Core_ClientInitialization_BlobOperations = passOnSuccess([
  {
    uri: "/azure/client-generator-core/client-initialization/blobs/sample-blob/content",
    method: "get",
    request: {
      query: {
        format: "text"
      }
    },
    response: {
      status: 200,
      body: json("This is the content of sample-blob")
    },
    kind: "MockApiDefinition",
  },
  {
    uri: "/azure/client-generator-core/client-initialization/blobs/sample-blob/properties",
    method: "get",
    request: {},
    response: {
      status: 200,
      body: json({
        name: "sample-blob",
        size: 42,
        contentType: "text/plain",
        createdOn: "2025-04-01T12:00:00Z"
      })
    },
    kind: "MockApiDefinition",
  },
  {
    uri: "/azure/client-generator-core/client-initialization/blobs/sample-blob/content",
    method: "put",
    request: {
      body: json("New content for sample-blob")
    },
    response: {
      status: 204
    },
    kind: "MockApiDefinition",
  },
  {
    uri: "/azure/client-generator-core/client-initialization/blobs/sample-blob",
    method: "delete",
    request: {},
    response: {
      status: 204
    },
    kind: "MockApiDefinition",
  }
]);