# Context Propagation Research: LangChain Agents and Subagents

## Executive Summary

This document provides research findings on context propagation in LangChain agents, specifically focusing on how `runtime.context` and configuration propagate from parent agents to subagents in the `deepagents` library.

## Key Findings

### 1. Context Propagation in the `task` Tool

**Does `runtime.context` from the parent agent propagate to subagent invocations?**

✅ **Yes, context propagates automatically via the `config` parameter.**

In `src/middleware/subagents.ts` (line 384), the subagent is invoked with the `config` parameter passed from the parent:

```typescript
const result = (await subagent.invoke(subagentState, config)) as Record<
  string,
  unknown
>;
```

The `config` parameter in LangChain contains:
- `configurable`: Runtime configuration values (e.g., `thread_id`, custom user data)
- `callbacks`: Callback handlers for tracing and logging
- `recursionLimit`: Control parameters
- `metadata`: Additional metadata
- All other RunnableConfig properties

### 2. How Subagents Access Parent Context

Subagents receive context through two mechanisms:

#### a. State Propagation
The `filterStateForSubagent()` function (lines 208-218) selectively passes state from parent to subagent:
- ✅ Includes: All custom state keys (e.g., custom context fields)
- ❌ Excludes: `messages`, `todos`, `jumpTo` (managed separately)

```typescript
function filterStateForSubagent(
  state: Record<string, unknown>,
): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (!EXCLUDED_STATE_KEYS.includes(key as never)) {
      filtered[key] = value;
    }
  }
  return filtered;
}
```

#### b. Config Propagation
The `config` parameter is passed directly to `subagent.invoke()`, ensuring:
- `config.configurable.*` values are accessible in subagent
- Callbacks and tracing continue across agent boundaries
- Custom configuration propagates seamlessly

### 3. Accessing Context in Tools

Tools within subagents can access context using LangGraph's `getCurrentTaskInput()`:

```typescript
import { getCurrentTaskInput } from "@langchain/langgraph";

const myTool = tool(async (input, config) => {
  // Access full state including custom context
  const currentState = getCurrentTaskInput<Record<string, unknown>>();
  
  // Access config.configurable
  const threadId = config?.configurable?.thread_id;
  const customContext = config?.configurable?.myCustomData;
  
  // Use context in tool logic
  return `Processing with context: ${customContext}`;
}, { ... });
```

## Examples of Context Sharing Patterns

### Example 1: Custom Context Schema

```typescript
import { createDeepAgent } from "deepagents";
import { Annotation } from "@langchain/langgraph";

// Define custom context schema
const CustomContext = Annotation.Root({
  userId: Annotation<string>,
  sessionData: Annotation<any>,
  preferences: Annotation<Record<string, any>>,
});

const agent = createDeepAgent({
  contextSchema: CustomContext,
  subagents: [
    {
      name: "research-agent",
      description: "Researcher with access to user context",
      systemPrompt: "You have access to user preferences in state",
      tools: [myTool],
    }
  ],
});

// Invoke with context
const result = await agent.invoke({
  messages: [{ role: "user", content: "Research topic" }],
  userId: "user123",
  sessionData: { locale: "en-US" },
  preferences: { depth: "comprehensive" },
});
```

### Example 2: Configurable Values

```typescript
const agent = createDeepAgent({
  subagents: [
    {
      name: "analyzer",
      description: "Analyzes with custom config",
      systemPrompt: "Analyze data",
      tools: [analysisTool],
    }
  ],
});

// Pass configurable values
const result = await agent.invoke(
  {
    messages: [{ role: "user", content: "Analyze data" }],
  },
  {
    configurable: {
      thread_id: "session-123",
      user_id: "user-456",
      apiKey: "secret-key",
      customSetting: "value",
    }
  }
);
```

### Example 3: Dynamic Tool Injection via Middleware

```typescript
import { createMiddleware } from "langchain";

// Create middleware that adds context-aware tools
const contextAwareMiddleware = createMiddleware({
  name: "contextAware",
  wrapModelCall: async (request, handler) => {
    // Access config in middleware
    const userId = request.config?.configurable?.user_id;
    
    // Can modify request based on context
    return handler({
      ...request,
      systemPrompt: `${request.systemPrompt}\n\nUser ID: ${userId}`,
    });
  },
});

const agent = createDeepAgent({
  subagents: [
    {
      name: "personalized-agent",
      description: "Agent with personalized context",
      systemPrompt: "Use context for personalization",
      middleware: [contextAwareMiddleware],
    }
  ],
});
```

## Multi-Agent System Patterns

### Pattern 1: Shared Runtime Configuration

All subagents automatically inherit the parent's runtime configuration:

```typescript
const agent = createDeepAgent({
  subagents: [
    { name: "agent-1", ... },
    { name: "agent-2", ... },
    { name: "agent-3", ... },
  ],
});

// All subagents receive the same config.configurable
await agent.invoke(input, {
  configurable: {
    environment: "production",
    traceId: "abc123",
  }
});
```

### Pattern 2: State-Based Context Sharing

Custom state keys automatically propagate to subagents:

```typescript
const CustomState = Annotation.Root({
  messages: Annotation<any[]>,
  sharedCache: Annotation<Record<string, any>>,
  metrics: Annotation<any>,
});

const agent = createDeepAgent({
  contextSchema: CustomState,
  subagents: [...],
});

// sharedCache and metrics are accessible in all subagents
await agent.invoke({
  messages: [...],
  sharedCache: { key: "value" },
  metrics: { startTime: Date.now() },
});
```

### Pattern 3: Nested Agent Hierarchies

Subagents can themselves have subagents, with context propagating down the chain:

```typescript
const leafAgent = createAgent({
  model: "gpt-4",
  tools: [toolWithContext],
});

const middleAgent = createDeepAgent({
  subagents: [
    {
      name: "leaf",
      description: "Leaf agent",
      runnable: leafAgent,  // Pre-compiled agent
    }
  ],
});

const topAgent = createDeepAgent({
  subagents: [
    {
      name: "middle", 
      description: "Middle agent",
      runnable: middleAgent,
    }
  ],
});

// Config propagates: top → middle → leaf
await topAgent.invoke(input, config);
```

## Implementation Details

### Current Implementation in `createTaskTool()`

The task tool implementation (lines 359-395) shows how context flows:

1. **Parent invokes task tool** with description and subagent_type
2. **Tool receives `config`** from parent execution context
3. **State is filtered** via `filterStateForSubagent()` to include custom fields
4. **New message is added** with subagent task description  
5. **Subagent is invoked** with `(subagentState, config)`
6. **Config.configurable values** are accessible within subagent
7. **Result is returned** with filtered state updates

### Default Middleware in Subagents

As seen in `src/agent.ts` (lines 130-149), default subagent middleware includes:

```typescript
defaultMiddleware: [
  todoListMiddleware(),
  createFilesystemMiddleware({ backend: filesystemBackend }),
  summarizationMiddleware({ model, trigger: { tokens: 170_000 } }),
  anthropicPromptCachingMiddleware({ unsupportedModelBehavior: "ignore" }),
  createPatchToolCallsMiddleware(),
]
```

All this middleware has access to the propagated config and state.

## Best Practices

### ✅ Do:
1. **Use `config.configurable`** for runtime parameters that need to propagate
2. **Use custom state keys** for data that should be accessible across agents
3. **Use `getCurrentTaskInput(config)`** in tools to access full state
4. **Define `contextSchema`** when you need typed custom state
5. **Pass config explicitly** in agent.invoke() for custom configuration

### ❌ Don't:
1. **Don't rely on excluded keys** (`messages`, `todos`, `jumpTo`) to propagate
2. **Don't modify config in middleware** unless you understand the implications
3. **Don't store secrets in state** - use secure config.configurable access
4. **Don't assume message history propagates** - only the task description goes to subagent

## Testing Context Propagation

Example test pattern:

```typescript
import { describe, it, expect } from "vitest";
import { createDeepAgent } from "deepagents";
import { tool } from "langchain";

describe("Context Propagation", () => {
  it("should propagate configurable to subagent", async () => {
    let capturedConfig: any = null;
    
    const contextTool = tool(async (input, config) => {
      capturedConfig = config;
      return "ok";
    }, {
      name: "context_tool",
      description: "Captures config",
      schema: z.object({}),
    });
    
    const agent = createDeepAgent({
      subagents: [{
        name: "test-agent",
        description: "Test agent",
        systemPrompt: "Use context_tool",
        tools: [contextTool],
      }],
    });
    
    await agent.invoke(
      { messages: [{ role: "user", content: "test" }] },
      { configurable: { testValue: "propagated!" } }
    );
    
    expect(capturedConfig?.configurable?.testValue).toBe("propagated!");
  });
});
```

## Related LangChain Concepts

### RunnableConfig Interface
The config object follows LangChain's `RunnableConfig` interface:
- **configurable**: Dictionary of runtime configuration
- **callbacks**: Tracing and monitoring callbacks
- **metadata**: Additional metadata for the run
- **tags**: Tags for organizing runs
- **recursionLimit**: Maximum recursion depth
- **maxConcurrency**: Concurrency limits

### LangGraph Checkpointing
When using checkpointers, the `thread_id` in `config.configurable` determines state persistence:

```typescript
const agent = createDeepAgent({
  checkpointer: new MemorySaver(),
});

await agent.invoke(input, {
  configurable: { thread_id: "conversation-123" }
});
```

## Conclusion

**Context propagation in deepagents is robust and automatic:**

1. ✅ Config values (including `config.configurable`) propagate to subagents
2. ✅ Custom state keys (except excluded ones) propagate to subagents
3. ✅ Tools can access context via `getCurrentTaskInput()` and `config` parameter
4. ✅ Nested subagents receive context from their parents
5. ✅ Middleware in subagents has access to propagated context

The current implementation provides a solid foundation for multi-agent systems with shared context. Developers can confidently use `config.configurable` and custom state keys to share data across agent hierarchies.

## References

- Source: `src/middleware/subagents.ts` - Task tool implementation
- Source: `src/agent.ts` - Deep agent creation
- Source: `tests/integration/subagents.test.ts` - Subagent tests
- LangChain Docs: [RunnableConfig](https://js.langchain.com/docs/expression_language/interface)
- LangGraph Docs: [Configuration](https://langchain-ai.github.io/langgraphjs/concepts/configuration/)
