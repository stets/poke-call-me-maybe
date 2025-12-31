#!/usr/bin/env node
/**
 * MCP Wrapper that adds custom tools on top of telnyx-mcp
 *
 * This wrapper:
 * 1. Spawns telnyx-mcp as a child process
 * 2. Adds custom tools like call_and_speak
 * 3. Proxies other tool calls to telnyx-mcp
 */

const { spawn } = require('child_process');
const readline = require('readline');

// Server URL for internal API calls
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3003';

// Default "from" number for outbound calls
const DEFAULT_FROM_NUMBER = process.env.TELNYX_FROM_NUMBER;

// Custom tools we're adding
const CUSTOM_TOOLS = {
  check_call_result: {
    name: 'check_call_result',
    description: `Check what happened on a call and get the transcription/conversation.

TIMING IS CRITICAL:
- For call_and_speak: Wait at least 45 seconds before checking
- For call_and_converse: Wait at least 60-90 seconds (longer for more turns)

If result shows "not found" or status is "in_progress", the call isn't done yet!
Wait another 30 seconds and try again. Keep retrying until status is "completed".

Returns:
- status: 'in_progress' or 'completed' (MUST be 'completed' to have full data)
- answered_by: 'human' or 'voicemail'
- transcription.text: What the person said
- conversation.messages: Full back-and-forth (for call_and_converse)
- hangup_cause: reason the call ended

Use cases:
- Wake-up call: Check if they answered and what they said
- Conversation: Get the full transcript of the multi-turn chat`,
    inputSchema: {
      type: 'object',
      properties: {
        call_control_id: {
          type: 'string',
          description: 'The call_control_id returned from call_and_speak'
        }
      },
      required: ['call_control_id']
    }
  },
  call_and_speak: {
    name: 'call_and_speak',
    description: `Make an outbound phone call and speak a message when answered.

The call will:
1. Dial the number
2. Play your message when answered
3. Wait 30 seconds for the person to respond (their speech is transcribed!)
4. Hang up automatically

IMPORTANT: After calling this, you MUST wait ~45 seconds then call check_call_result
with the returned call_control_id to see:
- Whether a human or voicemail answered
- The transcription of what they said!

Example: To call someone and say "Hello, this is your reminder!", use:
- to: "+15551234567"
- message: "Hello, this is your reminder!"
- connection_id: (your call control app ID)

Then wait 45 seconds and call check_call_result with the call_control_id.`,
    inputSchema: {
      type: 'object',
      properties: {
        connection_id: {
          type: 'string',
          description: 'The ID of the Call Control App to use for the call'
        },
        to: {
          type: 'string',
          description: 'The destination phone number in E.164 format (e.g., +15551234567)'
        },
        from: {
          type: 'string',
          description: 'Optional: The Telnyx phone number to call from. Uses the default configured number if not specified.'
        },
        message: {
          type: 'string',
          description: 'The message to speak when the call is answered (text-to-speech)'
        }
      },
      required: ['connection_id', 'to', 'message']
    }
  },
  call_and_converse: {
    name: 'call_and_converse',
    description: `Make an outbound phone call and have a two-way AI conversation.

This is different from call_and_speak - instead of just playing a message, the AI will:
1. Dial the number
2. Wait for the person to say hello first
3. Say the initial_message when they greet
4. Listen for their response
5. Generate an AI reply based on the system_prompt
6. Continue back-and-forth up to max_turns
7. Hang up automatically

The conversation uses Claude AI to generate responses, with Eleven Labs for voice.

CRITICAL TIMING: You MUST wait at least 60-90 seconds after calling this before using check_call_result.
Each conversation turn takes ~15 seconds. For a 5-turn call, wait at least 90 seconds.
If check_call_result returns "in_progress" or "not found", wait another 30 seconds and try again.

Example - Wake up call with conversation:
- system_prompt: "You are a friendly wake-up assistant. Be encouraging but firm about waking up."
- initial_message: "Good morning! Time to wake up. How are you feeling?"
- max_turns: 5`,
    inputSchema: {
      type: 'object',
      properties: {
        connection_id: {
          type: 'string',
          description: 'The ID of the Call Control App to use for the call'
        },
        to: {
          type: 'string',
          description: 'The destination phone number in E.164 format (e.g., +15551234567)'
        },
        from: {
          type: 'string',
          description: 'Optional: The Telnyx phone number to call from. Uses the default configured number if not specified.'
        },
        system_prompt: {
          type: 'string',
          description: 'Instructions for the AI on how to behave during the conversation'
        },
        initial_message: {
          type: 'string',
          description: 'The first message to say when the call is answered'
        },
        max_turns: {
          type: 'number',
          description: 'Maximum number of back-and-forth exchanges (default: 5)'
        }
      },
      required: ['connection_id', 'to', 'system_prompt', 'initial_message']
    }
  }
};

// Telnyx-mcp tools we want to include (minimal set)
const TELNYX_TOOLS = [
  'dial_calls',                        // needed internally by call_and_speak (hidden from client)
  'list_call_control_applications',    // to find connection_id
  'hangup_calls_actions'               // to cancel calls if needed
];

// Tools to hide from client (used internally only)
const HIDDEN_TOOLS = ['dial_calls'];

class MCPWrapper {
  constructor() {
    this.child = null;
    this.childTools = [];
    this.pendingRequests = new Map();
    this.requestId = 1000; // Start high to avoid conflicts
    this.initialized = false;
  }

  start() {
    // Start telnyx-mcp as child process
    const toolArgs = TELNYX_TOOLS.flatMap(t => ['--tool', t]);

    this.child = spawn('npx', ['-y', 'telnyx-mcp', ...toolArgs], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    });

    // Handle child stdout (MCP responses)
    const childRl = readline.createInterface({ input: this.child.stdout });
    childRl.on('line', (line) => this.handleChildMessage(line));

    // Forward child stderr to our stderr
    this.child.stderr.on('data', (data) => {
      process.stderr.write(data);
    });

    this.child.on('error', (err) => {
      process.stderr.write(`Child process error: ${err.message}\n`);
    });

    this.child.on('close', (code) => {
      process.stderr.write(`Child process exited with code ${code}\n`);
      process.exit(code || 0);
    });

    // Handle stdin (MCP requests from client)
    const stdinRl = readline.createInterface({ input: process.stdin });
    stdinRl.on('line', (line) => this.handleClientMessage(line));

    process.stdin.on('close', () => {
      if (this.child) this.child.kill();
      process.exit(0);
    });
  }

  sendToClient(message) {
    process.stdout.write(JSON.stringify(message) + '\n');
  }

  sendToChild(message) {
    if (this.child && this.child.stdin.writable) {
      this.child.stdin.write(JSON.stringify(message) + '\n');
    }
  }

  handleChildMessage(line) {
    try {
      const message = JSON.parse(line);

      // Check if this is a response to one of our proxied requests
      if (message.id !== undefined && this.pendingRequests.has(message.id)) {
        const { originalId, callback } = this.pendingRequests.get(message.id);
        this.pendingRequests.delete(message.id);

        if (callback) {
          callback(message);
        } else {
          // Just forward with original ID
          message.id = originalId;
          this.sendToClient(message);
        }
      } else {
        // Forward as-is (notifications, etc.)
        this.sendToClient(message);
      }
    } catch (err) {
      process.stderr.write(`Error parsing child message: ${err.message}\n`);
    }
  }

  async handleClientMessage(line) {
    try {
      const message = JSON.parse(line);

      if (message.method === 'initialize') {
        // Forward to child and wait for response
        this.proxyRequest(message);
      } else if (message.method === 'notifications/initialized') {
        // Forward notification
        this.sendToChild(message);
      } else if (message.method === 'tools/list') {
        // Get tools from child, then add our custom tools
        this.handleToolsList(message);
      } else if (message.method === 'tools/call') {
        this.handleToolCall(message);
      } else {
        // Proxy everything else
        this.proxyRequest(message);
      }
    } catch (err) {
      process.stderr.write(`Error handling client message: ${err.message}\n`);
    }
  }

  proxyRequest(message, callback) {
    const newId = this.requestId++;
    this.pendingRequests.set(newId, {
      originalId: message.id,
      callback
    });
    this.sendToChild({ ...message, id: newId });
  }

  handleToolsList(message) {
    // Get tools from child
    this.proxyRequest(message, (response) => {
      if (response.result && response.result.tools) {
        // Filter out hidden tools and add our custom tools
        const visibleChildTools = response.result.tools.filter(
          tool => !HIDDEN_TOOLS.includes(tool.name)
        );

        const allTools = [
          ...Object.values(CUSTOM_TOOLS),
          ...visibleChildTools
        ];

        this.childTools = response.result.tools;

        this.sendToClient({
          jsonrpc: '2.0',
          id: message.id,
          result: { tools: allTools }
        });
      } else {
        // Forward error as-is
        response.id = message.id;
        this.sendToClient(response);
      }
    });
  }

  handleToolCall(message) {
    const toolName = message.params?.name;
    const args = message.params?.arguments || {};

    // Log tool call
    process.stderr.write(`[mcp-wrapper] Tool called: ${toolName}\n`);
    process.stderr.write(`[mcp-wrapper] Arguments: ${JSON.stringify(args, null, 2)}\n`);

    if (CUSTOM_TOOLS[toolName]) {
      this.handleCustomToolCall(message);
    } else {
      // Proxy to child
      this.proxyRequest(message);
    }
  }

  async handleCustomToolCall(message) {
    const toolName = message.params?.name;
    const args = message.params?.arguments || {};

    try {
      let result;

      if (toolName === 'call_and_speak') {
        result = await this.callAndSpeak(args);
      } else if (toolName === 'check_call_result') {
        result = await this.checkCallResult(args);
      } else if (toolName === 'call_and_converse') {
        result = await this.callAndConverse(args);
      } else {
        throw new Error(`Unknown custom tool: ${toolName}`);
      }

      const responseText = JSON.stringify(result, null, 2);
      process.stderr.write(`[mcp-wrapper] Response for ${toolName}: ${responseText.substring(0, 500)}${responseText.length > 500 ? '...' : ''}\n`);

      this.sendToClient({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [{ type: 'text', text: responseText }]
        }
      });
    } catch (err) {
      process.stderr.write(`[mcp-wrapper] Error in ${toolName}: ${err.message}\n`);

      this.sendToClient({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true
        }
      });
    }
  }

  callAndSpeak(args) {
    return new Promise((resolve, reject) => {
      const { connection_id, to, message } = args;
      const from = args.from || DEFAULT_FROM_NUMBER;

      if (!connection_id || !to || !message) {
        reject(new Error('Missing required parameters: connection_id, to, message'));
        return;
      }

      if (!from) {
        reject(new Error('No "from" number provided and TELNYX_FROM_NUMBER environment variable is not set'));
        return;
      }

      // Encode message as base64 client_state
      const clientState = Buffer.from(JSON.stringify({ message })).toString('base64');

      // Call dial_calls via child process with AMD enabled
      const dialRequest = {
        jsonrpc: '2.0',
        id: this.requestId++,
        method: 'tools/call',
        params: {
          name: 'dial_calls',
          arguments: {
            connection_id,
            to,
            from,
            client_state: clientState,
            answering_machine_detection: 'detect_beep'  // Wait for voicemail beep to confirm
          }
        }
      };

      this.pendingRequests.set(dialRequest.id, {
        originalId: null,
        callback: (response) => {
          if (response.result?.isError) {
            reject(new Error(response.result.content?.[0]?.text || 'dial_calls failed'));
          } else {
            // Try to extract call_control_id from the response
            let call_control_id = null;
            try {
              const content = response.result?.content?.[0]?.text;
              if (content) {
                const parsed = JSON.parse(content);
                call_control_id = parsed?.data?.call_control_id;
              }
            } catch (e) {
              // Ignore parse errors
            }

            resolve({
              success: true,
              message: `Call initiated to ${to}. The message "${message}" will be spoken when the call is answered.`,
              call_control_id,
              tip: call_control_id
                ? 'Use check_call_result with this call_control_id after ~30 seconds to see if a human answered or it went to voicemail.'
                : null,
              dial_response: response.result
            });
          }
        }
      });

      this.sendToChild(dialRequest);
    });
  }

  async checkCallResult(args) {
    const { call_control_id } = args;

    if (!call_control_id) {
      throw new Error('Missing required parameter: call_control_id');
    }

    try {
      const response = await fetch(`${SERVER_URL}/call-result/${call_control_id}`);
      const result = await response.json();

      if (!result.found) {
        return {
          found: false,
          message: 'Call not found. It may still be ringing, or the call_control_id is incorrect. Try again in a few seconds.'
        };
      }

      // Add human-friendly interpretation
      let interpretation;
      if (result.answered_by === 'human') {
        interpretation = 'A human answered the call.';
      } else if (result.answered_by === 'machine') {
        interpretation = 'The call went to voicemail.';
      } else {
        interpretation = 'Could not determine if human or voicemail.';
      }

      return {
        ...result,
        interpretation
      };
    } catch (e) {
      throw new Error(`Failed to check call result: ${e.message}`);
    }
  }

  callAndConverse(args) {
    return new Promise((resolve, reject) => {
      const { connection_id, to, system_prompt, initial_message, max_turns } = args;
      const from = args.from || DEFAULT_FROM_NUMBER;

      if (!connection_id || !to || !system_prompt || !initial_message) {
        reject(new Error('Missing required parameters: connection_id, to, system_prompt, initial_message'));
        return;
      }

      if (!from) {
        reject(new Error('No "from" number provided and TELNYX_FROM_NUMBER environment variable is not set'));
        return;
      }

      // First, dial the call
      const dialRequest = {
        jsonrpc: '2.0',
        id: this.requestId++,
        method: 'tools/call',
        params: {
          name: 'dial_calls',
          arguments: {
            connection_id,
            to,
            from
            // No client_state needed - we'll use the conversation endpoint
          }
        }
      };

      this.pendingRequests.set(dialRequest.id, {
        originalId: null,
        callback: async (response) => {
          if (response.result?.isError) {
            reject(new Error(response.result.content?.[0]?.text || 'dial_calls failed'));
          } else {
            // Extract call_control_id
            let call_control_id = null;
            try {
              const content = response.result?.content?.[0]?.text;
              if (content) {
                const parsed = JSON.parse(content);
                call_control_id = parsed?.data?.call_control_id;
              }
            } catch (e) {
              // Ignore parse errors
            }

            if (!call_control_id) {
              reject(new Error('Could not get call_control_id from dial response'));
              return;
            }

            // Register the conversation with the server
            try {
              const registerResponse = await fetch(`${SERVER_URL}/start-conversation`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  callControlId: call_control_id,
                  systemPrompt: system_prompt,
                  initialMessage: initial_message,
                  maxTurns: max_turns || 5
                })
              });

              if (!registerResponse.ok) {
                const error = await registerResponse.text();
                reject(new Error(`Failed to register conversation: ${error}`));
                return;
              }

              resolve({
                success: true,
                message: `Conversation call initiated to ${to}. The AI will have a ${max_turns || 5}-turn conversation.`,
                call_control_id,
                tip: 'Wait for the call to complete, then use check_call_result to see the full conversation transcript.'
              });
            } catch (e) {
              reject(new Error(`Failed to register conversation: ${e.message}`));
            }
          }
        }
      });

      this.sendToChild(dialRequest);
    });
  }
}

// Start the wrapper
const wrapper = new MCPWrapper();
wrapper.start();

process.stderr.write('MCP Wrapper started with custom tools: ' + Object.keys(CUSTOM_TOOLS).join(', ') + '\n');
