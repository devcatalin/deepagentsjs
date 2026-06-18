# Context Propagation Implementation Summary

## Overview

This document summarizes the research and implementation completed for understanding and demonstrating context propagation in the `deepagents` library, specifically how `runtime.context` and configuration propagate from parent agents to subagents.

## Problem Statement

The research request asked:

1. **Does `runtime.context` from the parent agent propagate to subagent invocations?**
2. **How do subagents access the same context as the parent?**
3. **Examples of nested agents sharing context, dynamic tool injection, and multi-agent systems with shared runtime configuration**

## Key Findings

### ✅ Context DOES Propagate

**YES** - Context propagates automatically from parent agents to subagents through two primary mechanisms:

#### 1. Config Propagation (`config.configurable`)
- All values in `config.configurable` pass through to subagents
- This includes: `thread_id`, `user_id`, custom fields, API keys, etc.
- Implementation: Line 384 in `src/middleware/subagents.ts` passes `config` to `subagent.invoke()`

#### 2. State Propagation (Custom State Keys)
- Custom state keys automatically propagate (except `messages`, `todos`, `jumpTo`)
- Implementation: `filterStateForSubagent()` function in `src/middleware/subagents.ts`

### How to Access Context in Subagents

**In Tools:**
```typescript
import { getCurrentTaskInput } from "@langchain/langgraph";

const myTool = tool(async (input, config) => {
  // Access config.configurable
  const userId = config?.configurable?.user_id;
  
  // Access state
  const state = getCurrentTaskInput<MyState>(config);
  
  return `Processing for user ${userId}`;
}, { ... });
```

**In Middleware:**
```typescript
const middleware = createMiddleware({
  wrapModelCall: async (request, handler) => {
    const userId = request.config?.configurable?.user_id;
    // Use context...
    return handler(request);
  },
});
```

## Deliverables

### 1. Research Documentation
**File:** `/docs/CONTEXT_PROPAGATION_RESEARCH.md`

Comprehensive research document covering:
- Detailed explanation of context propagation mechanisms
- Code examples for each pattern
- Multi-agent system patterns
- Best practices and anti-patterns
- Testing strategies
- Related LangChain concepts

### 2. Working Example
**Files:** 
- `/examples/context-propagation/context-propagation-example.ts`
- `/examples/context-propagation/README.md`

Complete working example demonstrating:
- Config.configurable propagation
- Custom state propagation
- Tools accessing context in subagents
- Multiple parallel subagents with shared context

### 3. Integration Tests
**File:** `/tests/integration/context-propagation.test.ts`

Comprehensive test suite with 7 test cases covering:
- Config.configurable propagation to subagent tools
- Multi-level subagent context propagation
- Custom state field propagation
- State key filtering (excluded keys)
- Shared state updates from subagents
- Combined config + state propagation
- Parallel subagent context sharing

### 4. Documentation
All documentation includes:
- Clear code examples
- Architecture diagrams
- Usage patterns
- Best practices
- References to source code

## Implementation Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Parent Agent                             │
│  ┌──────────────┐    ┌────────────────────┐               │
│  │    Config    │    │   Custom State     │               │
│  │ .configurable│    │  (userId, prefs)   │               │
│  └──────┬───────┘    └────────┬───────────┘               │
│         │                      │                            │
│         └──────────┬───────────┘                            │
│                    │                                        │
│         ┌──────────▼──────────┐                            │
│         │   Task Tool         │                            │
│         │  (createTaskTool)   │                            │
│         └──────────┬──────────┘                            │
└────────────────────┼─────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
┌───────▼──────────┐     ┌───────▼──────────┐
│   Subagent A     │     │   Subagent B     │
│                  │     │                  │
│  ✓ config        │     │  ✓ config        │
│  ✓ state (filt.) │     │  ✓ state (filt.) │
│                  │     │                  │
│  ┌────────────┐  │     │  ┌────────────┐  │
│  │  Tool A    │  │     │  │  Tool B    │  │
│  │  (access   │  │     │  │  (access   │  │
│  │   context) │  │     │  │   context) │  │
│  └────────────┘  │     │  └────────────┘  │
└──────────────────┘     └──────────────────┘
```

## Code Quality

All delivered code:
- ✅ Passes ESLint checks
- ✅ Passes TypeScript type checking
- ✅ Follows project code style
- ✅ Includes comprehensive documentation
- ✅ Builds successfully

## Usage Examples

### Example 1: Simple Config Propagation
```typescript
const agent = createDeepAgent({
  subagents: [{ name: "worker", ... }],
});

await agent.invoke(
  { messages: [...] },
  { configurable: { user_id: "123" } }
);
// Subagent's tools can access config.configurable.user_id
```

### Example 2: Custom State Propagation
```typescript
const CustomState = Annotation.Root({
  messages: Annotation<any[]>({ reducer: (x, y) => x.concat(y) }),
  userId: Annotation<string>,
  preferences: Annotation<Record<string, any>>,
});

const agent = createDeepAgent({
  contextSchema: CustomState,
  subagents: [...],
});

await agent.invoke({
  messages: [...],
  userId: "user-123",
  preferences: { theme: "dark" },
});
// Subagent's tools can access userId and preferences via getCurrentTaskInput()
```

### Example 3: Tool Accessing Context
```typescript
const contextTool = tool(async (input, config) => {
  // Access configurable
  const userId = config?.configurable?.user_id;
  
  // Access state
  const state = getCurrentTaskInput<{ preferences?: any }>(config);
  const theme = state.preferences?.theme;
  
  return `User ${userId} prefers ${theme} theme`;
}, { ... });
```

## Testing

Tests can be run with:
```bash
npm test tests/integration/context-propagation.test.ts
```

Note: Tests require `ANTHROPIC_API_KEY` environment variable.

## Key Takeaways

1. ✅ **Context propagation is automatic** - No special configuration needed
2. ✅ **Two propagation mechanisms** - Config and State both work seamlessly
3. ✅ **Tools have full access** - Both config and state available in tools
4. ✅ **Nested propagation works** - Context flows through multiple levels
5. ✅ **Parallel execution supported** - Multiple subagents share same context

## References

- **Research Document**: `/docs/CONTEXT_PROPAGATION_RESEARCH.md`
- **Example Code**: `/examples/context-propagation/context-propagation-example.ts`
- **Example README**: `/examples/context-propagation/README.md`
- **Tests**: `/tests/integration/context-propagation.test.ts`
- **Implementation**: `/src/middleware/subagents.ts` (lines 208-395)

## Next Steps

For developers wanting to use context propagation:

1. **Read the research document** for comprehensive understanding
2. **Study the example** to see practical implementation
3. **Run the tests** to see it in action
4. **Implement in your agents** using the patterns demonstrated

For questions or issues, refer to:
- LangGraph Configuration Docs: https://langchain-ai.github.io/langgraphjs/concepts/configuration/
- LangChain RunnableConfig: https://js.langchain.com/docs/expression_language/interface
