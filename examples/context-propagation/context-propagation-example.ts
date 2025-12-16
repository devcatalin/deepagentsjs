/**
 * Example: Context Propagation in Deep Agents
 *
 * This example demonstrates how context and configuration propagate
 * from parent agents to subagents through the task tool.
 */

/* eslint-disable no-console */

import "dotenv/config";
import { z } from "zod";
import { tool } from "langchain";
import { createDeepAgent, type SubAgent } from "../../src/index.js";
import { Annotation } from "@langchain/langgraph";
import { getCurrentTaskInput } from "@langchain/langgraph";

// ============================================================================
// Example 1: Using config.configurable for Context Propagation
// ============================================================================

// Tool that accesses config.configurable
const contextAwareTool = tool(
  async ({ query }: { query: string }, config) => {
    // Access configurable values passed from parent
    const userId = config?.configurable?.user_id;
    const environment = config?.configurable?.environment;
    const apiKey = config?.configurable?.api_key;

    console.log("\n=== Tool Execution Context ===");
    console.log(`User ID: ${userId}`);
    console.log(`Environment: ${environment}`);
    console.log(`API Key present: ${apiKey ? "Yes" : "No"}`);
    console.log(`Query: ${query}`);

    return `Processed query "${query}" for user ${userId} in ${environment} environment`;
  },
  {
    name: "context_aware_tool",
    description: "A tool that uses context from config.configurable",
    schema: z.object({
      query: z.string().describe("The query to process"),
    }),
  },
);

// ============================================================================
// Example 2: Using Custom State for Context Propagation
// ============================================================================

// Define custom context schema
const CustomContext = Annotation.Root({
  // Standard message field
  messages: Annotation<any[]>({
    reducer: (x, y) => x.concat(y),
  }),
  // Custom context fields
  userId: Annotation<string>,
  sessionData: Annotation<Record<string, any>>,
  preferences: Annotation<Record<string, any>>,
  sharedCache: Annotation<Record<string, any>>({
    reducer: (x, y) => ({ ...x, ...y }),
  }),
});

// Tool that accesses state context
const stateAwareTool = tool(
  async ({ action }: { action: string }, config) => {
    // Access full state including custom context
    const currentState = getCurrentTaskInput<{
      userId?: string;
      sessionData?: Record<string, any>;
      preferences?: Record<string, any>;
      sharedCache?: Record<string, any>;
    }>(config);

    console.log("\n=== Tool State Context ===");
    console.log(`User ID from state: ${currentState.userId}`);
    console.log(`Session locale: ${currentState.sessionData?.locale}`);
    console.log(`Preference depth: ${currentState.preferences?.depth}`);
    console.log(
      `Shared cache keys: ${Object.keys(currentState.sharedCache || {}).join(", ")}`,
    );
    console.log(`Action: ${action}`);

    // Can update shared cache
    return {
      result: `Executed ${action} with user context`,
      cacheUpdate: { lastAction: action, timestamp: Date.now() },
    };
  },
  {
    name: "state_aware_tool",
    description: "A tool that uses custom state context",
    schema: z.object({
      action: z.string().describe("The action to perform"),
    }),
  },
);

// ============================================================================
// Example 3: Subagent with Context Access
// ============================================================================

const researchSubagent: SubAgent = {
  name: "research-agent",
  description: "Researcher that has access to user context and preferences",
  systemPrompt: `You are a researcher with access to user context.
  
When researching, consider:
- The user's preferences (available in state)
- The user's session data (available in state)
- Configuration values (available in config)

Use the context_aware_tool to perform context-aware operations.`,
  tools: [contextAwareTool],
};

const analysisSubagent: SubAgent = {
  name: "analysis-agent",
  description: "Analyzer that can read and update shared state",
  systemPrompt: `You are an analyzer with access to shared state.
  
You can:
- Read user preferences from state
- Access shared cache for coordination
- Update shared cache with your findings

Use the state_aware_tool to perform state-aware operations.`,
  tools: [stateAwareTool],
};

// ============================================================================
// Create Agent with Context Support
// ============================================================================

const agent = createDeepAgent({
  model: "claude-sonnet-4-20250514",
  contextSchema: CustomContext,
  systemPrompt: `You are a coordinator agent that delegates tasks to subagents.

You have access to two subagents:
1. research-agent: For context-aware research tasks
2. analysis-agent: For state-aware analysis tasks

The subagents will have access to:
- config.configurable values (user_id, environment, etc.)
- Custom state fields (userId, sessionData, preferences, sharedCache)

Delegate appropriately based on the task.`,
  subagents: [researchSubagent, analysisSubagent],
});

// ============================================================================
// Example Usage
// ============================================================================

async function demonstrateContextPropagation() {
  console.log("=== Context Propagation Example ===\n");

  // Example 1: Using config.configurable
  console.log("\n--- Example 1: Config.configurable Propagation ---");
  const result1 = await agent.invoke(
    {
      messages: [
        {
          role: "user",
          content: "Use the research-agent to search for 'LangChain context'",
        },
      ],
      userId: "user-123",
      sessionData: { locale: "en-US", timezone: "America/New_York" },
      preferences: { depth: "comprehensive", format: "detailed" },
      sharedCache: { knownTopics: ["AI", "LangChain"] },
    },
    {
      configurable: {
        user_id: "user-123",
        environment: "development",
        api_key: "dev-key-456",
        trace_id: "trace-001",
      },
      recursionLimit: 50,
    },
  );

  console.log("\n--- Result 1 ---");
  console.log("Messages:", result1.messages.length);
  console.log(
    "Last message:",
    result1.messages[result1.messages.length - 1]?.content?.slice(0, 200),
  );

  // Example 2: Using custom state
  console.log("\n\n--- Example 2: Custom State Propagation ---");
  const result2 = await agent.invoke(
    {
      messages: [
        {
          role: "user",
          content: "Use the analysis-agent to analyze with action 'compute'",
        },
      ],
      userId: "user-456",
      sessionData: { locale: "fr-FR", timezone: "Europe/Paris" },
      preferences: { depth: "summary", format: "concise" },
      sharedCache: { previousResults: [1, 2, 3] },
    },
    {
      configurable: {
        user_id: "user-456",
        environment: "production",
        trace_id: "trace-002",
      },
      recursionLimit: 50,
    },
  );

  console.log("\n--- Result 2 ---");
  console.log("User ID from state:", result2.userId);
  console.log("Shared cache keys:", Object.keys(result2.sharedCache || {}));
  console.log(
    "Last message:",
    result2.messages[result2.messages.length - 1]?.content?.slice(0, 200),
  );

  // Example 3: Multiple parallel subagent calls with shared context
  console.log("\n\n--- Example 3: Parallel Subagents with Shared Context ---");
  const result3 = await agent.invoke(
    {
      messages: [
        {
          role: "user",
          content:
            "Use both the research-agent (to search 'AI agents') and analysis-agent (to analyze with action 'summarize') in parallel",
        },
      ],
      userId: "user-789",
      sessionData: { locale: "en-US" },
      preferences: { depth: "detailed" },
      sharedCache: { sessionId: "multi-session-001" },
    },
    {
      configurable: {
        user_id: "user-789",
        environment: "staging",
        trace_id: "trace-003",
      },
      recursionLimit: 50,
    },
  );

  console.log("\n--- Result 3 ---");
  console.log("Messages:", result3.messages.length);
  console.log("Context was shared across both subagents");

  console.log("\n=== Demo Complete ===");
}

// ============================================================================
// Run the example
// ============================================================================

// Uncomment to run:
// demonstrateContextPropagation().catch(console.error);

export { agent, demonstrateContextPropagation };
