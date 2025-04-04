import "./main.tsp";
import "@azure-tools/typespec-client-generator-core";
import "@typespec/spector";

using Azure.ClientGenerator.Core;
using Spector;
@@clientNamespace(_Specs_.Azure.ClientGenerator.Core.ClientInitialization, "azure.clientgenerator.core.clientinitialization", "java")

// Scenario 1: Header parameter moved to client level
@scenarioDoc("""
  Client for testing a basic header parameter (name) moved to client level.
  The client should be generated with 'name' as a constructor parameter.
  
  Expected client usage:
  ```ts
  const client = new HeaderParamClient({
    name: "my-name"
  });
  
  client.withQuery("some-id");  // No need to pass name here
  client.withBody({ name: "test" });  // No need to pass name here
  ```
  """)
@client({
  name: "HeaderParamClient",
  service: _Specs_.Azure.ClientGenerator.Core.ClientInitialization.HeaderParam,
})
@clientInitialization(HeaderParamClientOptions)
@scenario
namespace _Specs_.Azure.ClientGenerator.Core.ClientInitialization.HeaderParamClient {
  model HeaderParamClientOptions {
    @doc("The name of the client.")
    @clientName("name")
    name: string;
  }
  op withQuery is _Specs_.Azure.ClientGenerator.Core.ClientInitialization.HeaderParam.withQuery;
  op withBody is _Specs_.Azure.ClientGenerator.Core.ClientInitialization.HeaderParam.withBody;
}

// Scenario 2: Multiple parameters (header and query) moved to client level
@scenarioDoc("""
  Client for testing multiple parameters (header and query) moved to client level.
  The client should be generated with both 'name' and 'region' as constructor parameters.
  
  Expected client usage:
  ```ts
  const client = new MultipleParamsClient({
    name: "my-name",
    region: "us-west"
  });
  
  client.withQuery("some-id");  // No need to pass name or region here
  client.withBody({ name: "test" });  // No need to pass name or region here
  ```
  """)
@client({
  name: "MultipleParamsClient",
  service: _Specs_.Azure.ClientGenerator.Core.ClientInitialization.MultipleParams,
})
@clientInitialization(MultipleParamsClientOptions)
@scenario
namespace _Specs_.Azure.ClientGenerator.Core.ClientInitialization.MultipleParamsClient {
  model MultipleParamsClientOptions {
    name: string;
    region: string;
  }
    op withQuery is _Specs_.Azure.ClientGenerator.Core.ClientInitialization.MultipleParams.withQuery;
    op withBody is _Specs_.Azure.ClientGenerator.Core.ClientInitialization.MultipleParams.withBody;
}

// Scenario 3: Mix of client-level and method-level parameters
@scenarioDoc("""
  Client for testing a mix of client-level and method-level parameters.
  The client should be generated with 'name' as constructor parameter,
  but 'region' should remain a method parameter.
  
  Expected client usage:
  ```ts
  const client = new MixedParamsClient({
    name: "my-name"
  });
  
  client.withQuery("some-id", { region: "us-west" });  // region stays as method param
  client.withBody({ name: "test" }, { region: "us-west" });  // region stays as method param
  ```
  """)
@client({
  name: "MixedParamsClient",
  service: _Specs_.Azure.ClientGenerator.Core.ClientInitialization.MixedParams,
})
@clientInitialization(MixedParamsClientOptions)
@scenario
namespace _Specs_.Azure.ClientGenerator.Core.ClientInitialization.MixedParamsClient {
  model MixedParamsClientOptions {
    name: string;
  }
  op withQuery is _Specs_.Azure.ClientGenerator.Core.ClientInitialization.MixedParams.withQuery;
  op withBody is _Specs_.Azure.ClientGenerator.Core.ClientInitialization.MixedParams.withBody;
}

// Scenario 4: Path parameter moved to client level
@scenarioDoc("""
  Client for testing a path parameter (blobName) moved to client level.
  The client should be generated with 'blobName' as a constructor parameter.
  
  Expected client usage:
  ```ts
  const client = new PathParamClient({
    blobName: "my-blob"
  });
  
  // No need to pass blobName to any operations
  client.getBlobContent({ format: "text" });  
  client.getBlobProperties();
  client.putBlobContent("Hello world");
  client.deleteBlob();
  ```
  """)
@client({
  name: "PathParamClient",
  service: _Specs_.Azure.ClientGenerator.Core.ClientInitialization.PathParam,
})
@clientInitialization(PathParamClientOptions)
@scenario
namespace _Specs_.Azure.ClientGenerator.Core.ClientInitialization.PathParamClient {
  model PathParamClientOptions {
    @doc("The name of the blob. This parameter is used in all operations.")
    blobName: string;
  }
    op withQuery is _Specs_.Azure.ClientGenerator.Core.ClientInitialization.PathParam.withQuery;
    op getStandalone is _Specs_.Azure.ClientGenerator.Core.ClientInitialization.PathParam.getStandalone;
    op withBody is _Specs_.Azure.ClientGenerator.Core.ClientInitialization.PathParam.withBody;
    op deleteStandalone is _Specs_.Azure.ClientGenerator.Core.ClientInitialization.PathParam.deleteStandalone;
}