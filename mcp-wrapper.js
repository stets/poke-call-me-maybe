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

// Custom tools we're adding
const CUSTOM_TOOLS = {
  check_call_result: {
    name: 'check_call_result',
    description: `Check if a call was answered by a human or went to voicemail.

Use this after making a call with call_and_speak to find out what happened.
Wait at least 30 seconds after initiating the call before checking.

Returns:
- answered_by: 'human' if a person answered, 'machine' if voicemail, 'not_sure' if unclear
- status: 'in_progress' if call is still active, 'completed' if call has ended
- hangup_cause: reason the call ended (if completed)

Example use case: After a wake-up call, check if the user picked up. If they didn't (machine/voicemail), you can shame them for sleeping through it!`,
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
    description: `Make an outbound phone call and automatically speak a message when answered.

Uses Answering Machine Detection (AMD) to determine if a human or voicemail answers.
The message will be spoken either way, but the server logs will show whether it was
answered by a human or went to voicemail.

This is the recommended way to make calls with voice messages.

Example: To call someone and say "Hello, this is your reminder!", use:
- to: "+15551234567"
- from: "+15559876543" (your Telnyx number)
- message: "Hello, this is your reminder!"
- connection_id: (your call control app ID)`,
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
          description: 'The Telnyx phone number to call from in E.164 format'
        },
        message: {
          type: 'string',
          description: 'The message to speak when the call is answered (text-to-speech)'
        }
      },
      required: ['connection_id', 'to', 'from', 'message']
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
      } else {
        throw new Error(`Unknown custom tool: ${toolName}`);
      }

      this.sendToClient({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      });
    } catch (err) {
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
      const { connection_id, to, from, message } = args;

      if (!connection_id || !to || !from || !message) {
        reject(new Error('Missing required parameters: connection_id, to, from, message'));
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
            answering_machine_detection: 'detect'  // Enable AMD
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
}

// Start the wrapper
const wrapper = new MCPWrapper();
wrapper.start();

process.stderr.write('MCP Wrapper started with custom tools: ' + Object.keys(CUSTOM_TOOLS).join(', ') + '\n');
