#!/usr/bin/env python3
"""
PythonAnywhere WSGI configuration for Grow a Garden Stock Tracker
This file runs our Node.js application
"""

import os
import sys
import subprocess
import time
import signal
import threading

# Add the project directory to Python path
project_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, project_dir)

# Global variable to store the Node.js process
node_process = None

def start_node_server():
    """Start the Node.js server"""
    global node_process
    
    try:
        # Install dependencies if needed
        print("Installing Node.js dependencies...")
        subprocess.run(['npm', 'install'], check=True, cwd=project_dir)
        
        # Start the Node.js server
        print("Starting Node.js server...")
        node_process = subprocess.Popen(
            ['node', 'server.js'],
            cwd=project_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        
        print(f"Node.js server started with PID: {node_process.pid}")
        return True
        
    except Exception as e:
        print(f"Error starting Node.js server: {e}")
        return False

def stop_node_server():
    """Stop the Node.js server"""
    global node_process
    
    if node_process:
        print(f"Stopping Node.js server (PID: {node_process.pid})...")
        node_process.terminate()
        try:
            node_process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            node_process.kill()
        print("Node.js server stopped")

def application(environ, start_response):
    """WSGI application entry point"""
    
    # Start Node.js server if not running
    if node_process is None or node_process.poll() is not None:
        if not start_node_server():
            # Return error if we can't start the server
            status = '500 Internal Server Error'
            response_headers = [('Content-type', 'text/plain')]
            start_response(status, response_headers)
            return [b'Failed to start Node.js server']
    
    # Proxy request to Node.js server
    try:
        # For now, return a simple response indicating the server is running
        status = '200 OK'
        response_headers = [('Content-type', 'text/html')]
        start_response(status, response_headers)
        
        html_content = """
        <!DOCTYPE html>
        <html>
        <head>
            <title>Grow a Garden Stock Tracker</title>
            <meta charset="utf-8">
        </head>
        <body>
            <h1>🚀 Grow a Garden Stock Tracker</h1>
            <p>✅ Node.js server is running on PythonAnywhere!</p>
            <p>📊 <a href="/api/stock">Stock Data API</a></p>
            <p>🌤️ <a href="/api/weather">Weather Data API</a></p>
            <p>📈 <a href="/api/status">Server Status</a></p>
            <hr>
            <p><strong>Server Features:</strong></p>
            <ul>
                <li>✅ Real-time stock updates every 5 minutes</li>
                <li>✅ Weather monitoring every 10 seconds</li>
                <li>✅ Public API endpoints</li>
                <li>✅ Socket.IO real-time updates</li>
                <li>✅ User notifications</li>
            </ul>
            <hr>
            <p><em>Powered by Node.js on PythonAnywhere</em></p>
        </body>
        </html>
        """
        
        return [html_content.encode('utf-8')]
        
    except Exception as e:
        status = '500 Internal Server Error'
        response_headers = [('Content-type', 'text/plain')]
        start_response(status, response_headers)
        return [f'Error: {str(e)}'.encode('utf-8')]

# Cleanup on exit
import atexit
atexit.register(stop_node_server)

# Handle signals
def signal_handler(signum, frame):
    stop_node_server()
    sys.exit(0)

signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)

# Start the Node.js server when the module is loaded
if __name__ == '__main__':
    start_node_server() 