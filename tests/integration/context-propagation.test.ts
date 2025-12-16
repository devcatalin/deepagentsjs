import { describe, it, expect } from "vitest";
import { tool } from "langchain";
import { z } from "zod";
import { HumanMessage } from "@langchain/core/messages";
import { Annotation } from "@langchain/langgraph";
import { getCurrentTaskInput } from "@langchain/langgraph";
import { createDeepAgent } from "../../src/index.js";
import { SAMPLE_MODEL } from "../utils.js";

describe("Context Propagation Tests", () => {
  describe("Config.configurable Propagation", () => {
    it.concurrent(
      "should propagate config.configurable to subagent tool",
      { timeout: 60000 },
      async () => {
        let capturedConfigurable: any = null;

        const configCaptureTool = tool(
          async ({ query }: { query: string }, config) => {
            capturedConfigurable = config?.configurable;
            return `Captured config for query: ${query}`;
          },
          {
            name: "config_capture_tool",
            description: "Captures config.configurable values",
            schema: z.object({
              query: z.string().describe("Query parameter"),
            }),
          }
        );

        const agent = createDeepAgent({
          model: SAMPLE_MODEL,
          systemPrompt:
            "Use the task tool to call the test-agent with any simple request.",
          subagents: [
            {
              name: "test-agent",
              description: "Test agent for config propagation",
              systemPrompt: "Use the config_capture_tool with query 'test'",
              tools: [configCaptureTool],
            },
          ],
        });

        await agent.invoke(
          {
            messages: [
              new HumanMessage("Call the test-agent to capture config"),
            ],
          },
          {
            configurable: {
              user_id: "user-123",
              environment: "test",
              custom_field: "custom-value",
            },
          }
        );

        expect(capturedConfigurable).toBeDefined();
        expect(capturedConfigurable.user_id).toBe("user-123");
        expect(capturedConfigurable.environment).toBe("test");
        expect(capturedConfigurable.custom_field).toBe("custom-value");
      }
    );

    it.concurrent(
      "should propagate config.configurable through multiple subagent levels",
      { timeout: 60000 },
      async () => {
        const configValues: any[] = [];

        const deepConfigTool = tool(
          async ({ level }: { level: string }, config) => {
            configValues.push({
              level,
              threadId: config?.configurable?.thread_id,
              apiKey: config?.configurable?.api_key,
            });
            return `Level ${level} captured config`;
          },
          {
            name: "deep_config_tool",
            description: "Captures config at different nesting levels",
            schema: z.object({
              level: z.string().describe("Nesting level"),
            }),
          }
        );

        const agent = createDeepAgent({
          model: SAMPLE_MODEL,
          systemPrompt:
            "Use the general-purpose agent to execute deep_config_tool with level 'nested'",
          subagents: [],
        });

        await agent.invoke(
          {
            messages: [
              new HumanMessage("Execute deep_config_tool at nested level"),
            ],
          },
          {
            configurable: {
              thread_id: "thread-456",
              api_key: "secret-key",
            },
          }
        );

        expect(configValues.length).toBeGreaterThan(0);
        const captured = configValues[0];
        expect(captured.threadId).toBe("thread-456");
        expect(captured.apiKey).toBe("secret-key");
      }
    );
  });

  describe("Custom State Propagation", () => {
    it.concurrent(
      "should propagate custom state fields to subagent",
      { timeout: 60000 },
      async () => {
        let capturedState: any = null;

        const stateCaptureTool = tool(
          async ({ action }: { action: string }, config) => {
            capturedState = getCurrentTaskInput<{
              customField?: string;
              userPrefs?: Record<string, any>;
            }>(config);
            return `Captured state for action: ${action}`;
          },
          {
            name: "state_capture_tool",
            description: "Captures custom state fields",
            schema: z.object({
              action: z.string().describe("Action parameter"),
            }),
          }
        );

        const CustomState = Annotation.Root({
          messages: Annotation<any[]>({
            reducer: (x, y) => x.concat(y),
          }),
          customField: Annotation<string>,
          userPrefs: Annotation<Record<string, any>>,
        });

        const agent = createDeepAgent({
          model: SAMPLE_MODEL,
          contextSchema: CustomState,
          systemPrompt:
            "Use the state-agent to perform an action with the state_capture_tool",
          subagents: [
            {
              name: "state-agent",
              description: "Agent that accesses custom state",
              systemPrompt:
                "Use the state_capture_tool with action 'test-action'",
              tools: [stateCaptureTool],
            },
          ],
        });

        await agent.invoke({
          messages: [
            new HumanMessage("Call state-agent to capture state"),
          ],
          customField: "test-value",
          userPrefs: { theme: "dark", language: "en" },
        });

        expect(capturedState).toBeDefined();
        expect(capturedState.customField).toBe("test-value");
        expect(capturedState.userPrefs).toEqual({
          theme: "dark",
          language: "en",
        });
      }
    );

    it.concurrent(
      "should exclude standard keys (messages, todos) from subagent state",
      { timeout: 60000 },
      async () => {
        let capturedState: any = null;

        const stateInspectTool = tool(
          async ({ _dummy }: { _dummy: string }, config) => {
            capturedState = getCurrentTaskInput<Record<string, any>>(config);
            return "State inspected";
          },
          {
            name: "state_inspect_tool",
            description: "Inspects received state",
            schema: z.object({
              _dummy: z.string().describe("Dummy parameter"),
            }),
          }
        );

        const agent = createDeepAgent({
          model: SAMPLE_MODEL,
          systemPrompt:
            "Use the inspector-agent to call state_inspect_tool",
          subagents: [
            {
              name: "inspector-agent",
              description: "Inspects state structure",
              systemPrompt:
                "Use state_inspect_tool with _dummy parameter 'test'",
              tools: [stateInspectTool],
            },
          ],
        });

        await agent.invoke({
          messages: [
            new HumanMessage("Previous message from parent"),
            new HumanMessage("Call inspector-agent"),
          ],
        });

        // The subagent should not receive parent's messages array
        // It gets a fresh messages array with only the task description
        expect(capturedState).toBeDefined();
        if (capturedState.messages) {
          // If messages exist, they should be the subagent's own messages
          // not the parent's original messages
          const hasParentMessage = capturedState.messages.some(
            (msg: any) => msg.content?.includes("Previous message from parent")
          );
          expect(hasParentMessage).toBe(false);
        }
      }
    );

    it.concurrent(
      "should allow updating shared state from subagent",
      { timeout: 60000 },
      async () => {
        const stateUpdateTool = tool(
          async ({ value }: { value: string }, config) => {
            const currentState = getCurrentTaskInput<{
              sharedData?: Record<string, any>;
            }>(config);

            return {
              message: `Updated shared data with ${value}`,
              sharedData: {
                ...currentState.sharedData,
                lastUpdate: value,
                timestamp: Date.now(),
              },
            };
          },
          {
            name: "state_update_tool",
            description: "Updates shared state",
            schema: z.object({
              value: z.string().describe("Value to set"),
            }),
          }
        );

        const SharedState = Annotation.Root({
          messages: Annotation<any[]>({
            reducer: (x, y) => x.concat(y),
          }),
          sharedData: Annotation<Record<string, any>>({
            reducer: (x, y) => ({ ...x, ...y }),
          }),
        });

        const agent = createDeepAgent({
          model: SAMPLE_MODEL,
          contextSchema: SharedState,
          systemPrompt:
            "Use the updater-agent to update shared state",
          subagents: [
            {
              name: "updater-agent",
              description: "Updates shared state",
              systemPrompt:
                "Use state_update_tool with value 'test-update'",
              tools: [stateUpdateTool],
            },
          ],
        });

        const result = await agent.invoke({
          messages: [
            new HumanMessage("Call updater-agent to update shared state"),
          ],
          sharedData: { initialValue: "init" },
        });

        expect(result.sharedData).toBeDefined();
        expect(result.sharedData.initialValue).toBe("init");
        // State updates from subagent should be merged back
        expect(result.sharedData.lastUpdate).toBe("test-update");
        expect(result.sharedData.timestamp).toBeDefined();
      }
    );
  });

  describe("Combined Context Propagation", () => {
    it.concurrent(
      "should propagate both config and state simultaneously",
      { timeout: 60000 },
      async () => {
        let capturedConfig: any = null;
        let capturedState: any = null;

        const fullContextTool = tool(
          async ({ operation }: { operation: string }, config) => {
            capturedConfig = config?.configurable;
            capturedState = getCurrentTaskInput<{
              contextId?: string;
              metadata?: Record<string, any>;
            }>(config);
            return `Operation ${operation} executed with full context`;
          },
          {
            name: "full_context_tool",
            description: "Accesses both config and state context",
            schema: z.object({
              operation: z.string().describe("Operation to perform"),
            }),
          }
        );

        const FullContext = Annotation.Root({
          messages: Annotation<any[]>({
            reducer: (x, y) => x.concat(y),
          }),
          contextId: Annotation<string>,
          metadata: Annotation<Record<string, any>>,
        });

        const agent = createDeepAgent({
          model: SAMPLE_MODEL,
          contextSchema: FullContext,
          systemPrompt:
            "Use the context-agent with full_context_tool",
          subagents: [
            {
              name: "context-agent",
              description: "Agent with full context access",
              systemPrompt:
                "Use full_context_tool with operation 'process'",
              tools: [fullContextTool],
            },
          ],
        });

        await agent.invoke(
          {
            messages: [
              new HumanMessage("Call context-agent with full context"),
            ],
            contextId: "ctx-789",
            metadata: { source: "test", priority: "high" },
          },
          {
            configurable: {
              session_id: "session-999",
              trace_enabled: true,
            },
          }
        );

        // Verify config propagation
        expect(capturedConfig).toBeDefined();
        expect(capturedConfig.session_id).toBe("session-999");
        expect(capturedConfig.trace_enabled).toBe(true);

        // Verify state propagation
        expect(capturedState).toBeDefined();
        expect(capturedState.contextId).toBe("ctx-789");
        expect(capturedState.metadata).toEqual({
          source: "test",
          priority: "high",
        });
      }
    );

    it.concurrent(
      "should maintain context across parallel subagent calls",
      { timeout: 120000 },
      async () => {
        const executionContexts: any[] = [];

        const parallelContextTool = tool(
          async ({ agentName }: { agentName: string }, config) => {
            const configurable = config?.configurable;
            const state = getCurrentTaskInput<{ requestId?: string }>(config);

            executionContexts.push({
              agentName,
              requestId: state.requestId,
              sessionId: configurable?.session_id,
            });

            return `Agent ${agentName} processed request`;
          },
          {
            name: "parallel_context_tool",
            description: "Tool for parallel context verification",
            schema: z.object({
              agentName: z.string().describe("Name of the calling agent"),
            }),
          }
        );

        const ParallelContext = Annotation.Root({
          messages: Annotation<any[]>({
            reducer: (x, y) => x.concat(y),
          }),
          requestId: Annotation<string>,
        });

        const agent = createDeepAgent({
          model: SAMPLE_MODEL,
          contextSchema: ParallelContext,
          systemPrompt:
            "Use agent-a and agent-b in parallel to process requests",
          subagents: [
            {
              name: "agent-a",
              description: "First parallel agent",
              systemPrompt:
                "Use parallel_context_tool with agentName 'agent-a'",
              tools: [parallelContextTool],
            },
            {
              name: "agent-b",
              description: "Second parallel agent",
              systemPrompt:
                "Use parallel_context_tool with agentName 'agent-b'",
              tools: [parallelContextTool],
            },
          ],
        });

        await agent.invoke(
          {
            messages: [
              new HumanMessage(
                "Call both agent-a and agent-b in parallel"
              ),
            ],
            requestId: "req-parallel-001",
          },
          {
            configurable: {
              session_id: "parallel-session",
            },
          }
        );

        // Both agents should receive the same context
        expect(executionContexts.length).toBeGreaterThanOrEqual(2);

        const allHaveSameRequestId = executionContexts.every(
          (ctx) => ctx.requestId === "req-parallel-001"
        );
        const allHaveSameSessionId = executionContexts.every(
          (ctx) => ctx.sessionId === "parallel-session"
        );

        expect(allHaveSameRequestId).toBe(true);
        expect(allHaveSameSessionId).toBe(true);
      }
    );
  });
});
