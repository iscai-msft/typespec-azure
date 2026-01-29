import { EventsTestLibrary } from "@typespec/events/testing";
import { SSETestLibrary } from "@typespec/sse/testing";
import { StreamsTestLibrary } from "@typespec/streams/testing";
import { deepStrictEqual, ok, strictEqual } from "assert";
import { beforeEach, describe, it } from "vitest";
import { SdkTestRunner, createSdkTestRunner } from "../test-host.js";
import { getServiceMethodOfClient } from "../utils.js";

let runner: SdkTestRunner;

beforeEach(async () => {
  runner = await createSdkTestRunner({
    librariesToAdd: [StreamsTestLibrary, SSETestLibrary, EventsTestLibrary],
    autoImports: [`@typespec/http/streams`, "@typespec/streams", "@typespec/sse"],
    autoUsings: ["TypeSpec.Http.Streams", "TypeSpec.Streams", "TypeSpec.SSE", "TypeSpec.Events"],
    emitterName: "@azure-tools/typespec-python",
  });
});

describe("stream request", () => {
  it("http stream request", async () => {
    await runner.compileWithBuiltInService(
      `
        @route("/")
        op get(stream: HttpStream<Thing, "application/jsonl", string>): void;

        model Thing { id: string }
      `,
    );
    const sdkPackage = runner.context.sdkPackage;
    const method = getServiceMethodOfClient(sdkPackage);
    strictEqual(method.parameters[0].type.kind, "model");
    strictEqual(method.parameters[0].type.properties[1].type.kind, "bytes");
    strictEqual(method.parameters[0].type.properties[1].type.encode, "bytes");
    deepStrictEqual(method.operation.bodyParam?.type, method.parameters[0].type.properties[1].type);

    // stream metadata on body param
    const bodyMeta = method.operation.bodyParam?.streamMetadata;
    ok(bodyMeta);
    strictEqual(bodyMeta.streamType.kind, "model");
    strictEqual(bodyMeta.streamType.name, "Thing");
    deepStrictEqual(bodyMeta.contentTypes, ["application/jsonl"]);
  });

  it("json stream request", async () => {
    await runner.compileWithBuiltInService(
      `
        @route("/")
        op get(stream: JsonlStream<Thing>): void;

        model Thing { id: string }
      `,
    );
    const sdkPackage = runner.context.sdkPackage;
    const method = getServiceMethodOfClient(sdkPackage);
    strictEqual(method.parameters[0].type.kind, "model");
    strictEqual(method.parameters[0].type.properties[1].type.kind, "bytes");
    strictEqual(method.parameters[0].type.properties[1].type.encode, "bytes");
    deepStrictEqual(method.operation.bodyParam?.type, method.parameters[0].type.properties[1].type);

    // stream metadata on body param
    const bodyMeta = method.operation.bodyParam?.streamMetadata;
    ok(bodyMeta);
    strictEqual(bodyMeta.streamType.kind, "model");
    strictEqual(bodyMeta.streamType.name, "Thing");
    deepStrictEqual(bodyMeta.contentTypes, ["application/jsonl"]);
  });

  it("custom stream request", async () => {
    await runner.compileWithBuiltInService(
      `
        @streamOf(Thing)
        model CustomStream {
          @header contentType: "custom/built-here";
          @body body: bytes;
        }

        @route("/")
        op get(stream: CustomStream): void;

        model Thing { id: string }
      `,
    );
    const sdkPackage = runner.context.sdkPackage;
    const method = getServiceMethodOfClient(sdkPackage);
    strictEqual(method.parameters[0].type.kind, "model");
    strictEqual(method.parameters[0].type.properties[1].type.kind, "bytes");
    strictEqual(method.parameters[0].type.properties[1].type.encode, "bytes");
    deepStrictEqual(method.operation.bodyParam?.type, method.parameters[0].type.properties[1].type);

    // stream metadata on body param
    const bodyMeta = method.operation.bodyParam?.streamMetadata;
    ok(bodyMeta);
    strictEqual(bodyMeta.streamType.kind, "model");
    strictEqual(bodyMeta.streamType.name, "Thing");
    deepStrictEqual(bodyMeta.contentTypes, ["custom/built-here"]);
  });

  it("spread stream request", async () => {
    await runner.compileWithBuiltInService(
      `
        @route("/")
        op get(...JsonlStream<Thing>): void;

        model Thing { id: string }
      `,
    );
    const sdkPackage = runner.context.sdkPackage;
    const method = getServiceMethodOfClient(sdkPackage);
    strictEqual(method.parameters[1].type.kind, "bytes");
    strictEqual(method.parameters[1].type.encode, "bytes");
    deepStrictEqual(method.operation.bodyParam?.type, method.parameters[1].type);

    // stream metadata on body param
    const bodyMeta = method.operation.bodyParam?.streamMetadata;
    ok(bodyMeta);
    strictEqual(bodyMeta.streamType.kind, "model");
    strictEqual(bodyMeta.streamType.name, "Thing");
    deepStrictEqual(bodyMeta.contentTypes, ["application/jsonl"]);
  });

  it("sse request", async () => {
    await runner.compileWithBuiltInService(
      `
        model UserConnect {
          username: string;
          time: string;
        }

        model UserMessage {
          username: string;
          time: string;
          text: string;
        }

        model UserDisconnect {
          username: string;
          time: string;
        }

        @Events.events
        union ChannelEvents {
          userconnect: UserConnect,
          usermessage: UserMessage,
          userdisconnect: UserDisconnect,

          @Events.contentType("text/plain")
          @terminalEvent
          "[unsubscribe]",
        }

        op subscribeToChannel(stream: SSEStream<ChannelEvents>): void;
      `,
    );
    const sdkPackage = runner.context.sdkPackage;
    const method = getServiceMethodOfClient(sdkPackage);
    strictEqual(method.parameters[0].type.kind, "model");
    strictEqual(method.parameters[0].type.properties[1].type.kind, "bytes");
    strictEqual(method.parameters[0].type.properties[1].type.encode, "bytes");
    deepStrictEqual(method.operation.bodyParam?.type, method.parameters[0].type.properties[1].type);

    // stream metadata on body param - SSE streams have union streamType
    const bodyMeta = method.operation.bodyParam?.streamMetadata;
    ok(bodyMeta);
    strictEqual(bodyMeta.streamType.kind, "union");
    strictEqual(bodyMeta.streamType.name, "ChannelEvents");
    deepStrictEqual(bodyMeta.contentTypes, ["text/event-stream"]);
  });
});

describe("stream response", () => {
  it("http stream response", async () => {
    await runner.compileWithBuiltInService(
      `
        @route("/")
        op get(): HttpStream<Thing, "application/jsonl", string>;

        model Thing { id: string }
      `,
    );
    const sdkPackage = runner.context.sdkPackage;
    const method = getServiceMethodOfClient(sdkPackage);
    strictEqual(method.response.type?.kind, "bytes");
    strictEqual(method.response.type?.encode, "bytes");
    strictEqual(method.operation.responses.length, 1);
    strictEqual(method.operation.responses[0].type?.kind, "bytes");
    strictEqual(method.operation.responses[0].type?.encode, "bytes");

    // stream metadata on HTTP response
    const responseMeta = method.operation.responses[0].streamMetadata;
    ok(responseMeta);
    strictEqual(responseMeta.streamType.kind, "model");
    strictEqual(responseMeta.streamType.name, "Thing");
    deepStrictEqual(responseMeta.contentTypes, ["application/jsonl"]);

    // stream metadata propagated to method response
    const methodMeta = method.response.streamMetadata;
    ok(methodMeta);
    strictEqual(methodMeta.streamType.kind, "model");
    strictEqual(methodMeta.streamType.name, "Thing");
    deepStrictEqual(methodMeta.contentTypes, ["application/jsonl"]);
  });

  it("json stream response", async () => {
    await runner.compileWithBuiltInService(
      `
        @route("/")
        op get(): JsonlStream<Thing>;

        model Thing { id: string }
      `,
    );
    const sdkPackage = runner.context.sdkPackage;
    const method = getServiceMethodOfClient(sdkPackage);
    strictEqual(method.response.type?.kind, "bytes");
    strictEqual(method.response.type?.encode, "bytes");
    strictEqual(method.operation.responses.length, 1);
    strictEqual(method.operation.responses[0].type?.kind, "bytes");
    strictEqual(method.operation.responses[0].type?.encode, "bytes");

    // stream metadata on HTTP response
    const responseMeta = method.operation.responses[0].streamMetadata;
    ok(responseMeta);
    strictEqual(responseMeta.streamType.kind, "model");
    strictEqual(responseMeta.streamType.name, "Thing");
    deepStrictEqual(responseMeta.contentTypes, ["application/jsonl"]);

    // stream metadata propagated to method response
    const methodMeta = method.response.streamMetadata;
    ok(methodMeta);
    strictEqual(methodMeta.streamType.kind, "model");
    deepStrictEqual(methodMeta.contentTypes, ["application/jsonl"]);
  });

  it("custom stream response", async () => {
    await runner.compileWithBuiltInService(
      `
        @streamOf(Thing)
        model CustomStream {
          @header contentType: "custom/built-here";
          @body body: bytes;
        }

        @route("/")
        op get(): CustomStream;

        model Thing { id: string }
      `,
    );
    const sdkPackage = runner.context.sdkPackage;
    const method = getServiceMethodOfClient(sdkPackage);
    strictEqual(method.response.type?.kind, "bytes");
    strictEqual(method.response.type?.encode, "bytes");
    strictEqual(method.operation.responses.length, 1);
    strictEqual(method.operation.responses[0].type?.kind, "bytes");
    strictEqual(method.operation.responses[0].type?.encode, "bytes");

    // stream metadata on HTTP response
    const responseMeta = method.operation.responses[0].streamMetadata;
    ok(responseMeta);
    strictEqual(responseMeta.streamType.kind, "model");
    strictEqual(responseMeta.streamType.name, "Thing");
    deepStrictEqual(responseMeta.contentTypes, ["custom/built-here"]);

    // stream metadata propagated to method response
    const methodMeta = method.response.streamMetadata;
    ok(methodMeta);
    strictEqual(methodMeta.streamType.kind, "model");
    deepStrictEqual(methodMeta.contentTypes, ["custom/built-here"]);
  });

  it("intersection stream response", async () => {
    await runner.compileWithBuiltInService(
      `
        @route("/")
        op get(): JsonlStream<Thing> & { @statusCode statusCode: 204; };

        model Thing { id: string }
      `,
    );
    const sdkPackage = runner.context.sdkPackage;
    const method = getServiceMethodOfClient(sdkPackage);
    strictEqual(method.response.type?.kind, "bytes");
    strictEqual(method.response.type?.encode, "bytes");
    strictEqual(method.operation.responses.length, 1);
    strictEqual(method.operation.responses[0].type?.kind, "bytes");
    strictEqual(method.operation.responses[0].type?.encode, "bytes");

    // stream metadata on HTTP response
    const responseMeta = method.operation.responses[0].streamMetadata;
    ok(responseMeta);
    strictEqual(responseMeta.streamType.kind, "model");
    strictEqual(responseMeta.streamType.name, "Thing");
    deepStrictEqual(responseMeta.contentTypes, ["application/jsonl"]);

    // stream metadata propagated to method response
    const methodMeta = method.response.streamMetadata;
    ok(methodMeta);
    strictEqual(methodMeta.streamType.kind, "model");
    deepStrictEqual(methodMeta.contentTypes, ["application/jsonl"]);
  });

  it("sse response", async () => {
    await runner.compileWithBuiltInService(
      `
        model UserConnect {
          username: string;
          time: string;
        }

        model UserMessage {
          username: string;
          time: string;
          text: string;
        }

        model UserDisconnect {
          username: string;
          time: string;
        }

        @Events.events
        union ChannelEvents {
          userconnect: UserConnect,
          usermessage: UserMessage,
          userdisconnect: UserDisconnect,

          @Events.contentType("text/plain")
          @terminalEvent
          "[unsubscribe]",
        }

        op subscribeToChannel(): SSEStream<ChannelEvents>;
      `,
    );
    const sdkPackage = runner.context.sdkPackage;
    const method = getServiceMethodOfClient(sdkPackage);
    strictEqual(method.response.type?.kind, "bytes");
    strictEqual(method.response.type?.encode, "bytes");
    strictEqual(method.operation.responses.length, 1);
    strictEqual(method.operation.responses[0].type?.kind, "bytes");
    strictEqual(method.operation.responses[0].type?.encode, "bytes");

    // stream metadata on HTTP response - SSE streams have union streamType
    const responseMeta = method.operation.responses[0].streamMetadata;
    ok(responseMeta);
    strictEqual(responseMeta.streamType.kind, "union");
    strictEqual(responseMeta.streamType.name, "ChannelEvents");
    deepStrictEqual(responseMeta.contentTypes, ["text/event-stream"]);

    // stream metadata propagated to method response
    const methodMeta = method.response.streamMetadata;
    ok(methodMeta);
    strictEqual(methodMeta.streamType.kind, "union");
    strictEqual(methodMeta.streamType.name, "ChannelEvents");
    deepStrictEqual(methodMeta.contentTypes, ["text/event-stream"]);
  });
});
