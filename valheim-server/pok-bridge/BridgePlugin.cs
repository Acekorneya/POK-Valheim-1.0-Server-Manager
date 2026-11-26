using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using BepInEx;
using UnityEngine;

namespace POKValheimBridge
{
    [BepInPlugin("com.pok.valheim.bridge", "POK-Valheim Bridge (Server-Side RCON)", "1.0.0")]
    public class BridgePlugin : BaseUnityPlugin
    {
        private const int SERVERDATA_AUTH = 3;
        private const int SERVERDATA_AUTH_RESPONSE = 2;
        private const int SERVERDATA_EXECCOMMAND = 2;
        private const int SERVERDATA_RESPONSE_VALUE = 0;

        private readonly ConcurrentQueue<PendingCommand> _mainThreadQueue = new ConcurrentQueue<PendingCommand>();
        private TcpListener _listener;
        private CancellationTokenSource _cts;
        private string _rconPassword = "";
        private int _rconPort = 2458;

        private class PendingCommand
        {
            public string Command;
            public TaskCompletionSource<string> Completion;
        }

        private void Awake()
        {
            var enabledEnv = Environment.GetEnvironmentVariable("POK_RCON_ENABLED") ?? "false";
            if (!enabledEnv.Equals("true", StringComparison.OrdinalIgnoreCase))
            {
                Logger.LogInfo("[POK-Bridge] RCON disabled (POK_RCON_ENABLED != true).");
                return;
            }

            if (int.TryParse(Environment.GetEnvironmentVariable("POK_RCON_PORT"), out var port) && port > 0)
            {
                _rconPort = port;
            }
            _rconPassword = Environment.GetEnvironmentVariable("POK_RCON_PASSWORD") ?? "";

            if (string.IsNullOrEmpty(_rconPassword))
            {
                Logger.LogWarning("[POK-Bridge] POK_RCON_PASSWORD is empty — RCON listener will not start for security.");
                return;
            }

            _cts = new CancellationTokenSource();
            StartRconServer(_cts.Token);
            Logger.LogInfo($"[POK-Bridge] Built-in Source RCON listening on TCP port {_rconPort} (100% server-side, vanilla clients supported).");
        }

        private void OnDestroy()
        {
            try { _cts?.Cancel(); } catch { }
            try { _listener?.Stop(); } catch { }
        }

        private void Update()
        {
            while (_mainThreadQueue.TryDequeue(out var pending))
            {
                try
                {
                    var result = ExecuteOnMainThread(pending.Command);
                    pending.Completion.TrySetResult(result);
                }
                catch (Exception ex)
                {
                    pending.Completion.TrySetResult($"Error: {ex.Message}");
                }
            }
        }

        private void StartRconServer(CancellationToken token)
        {
            Task.Run(async () =>
            {
                try
                {
                    _listener = new TcpListener(IPAddress.Any, _rconPort);
                    _listener.Start();
                    while (!token.IsCancellationRequested)
                    {
                        var client = await _listener.AcceptTcpClientAsync();
                        _ = HandleClientAsync(client, token);
                    }
                }
                catch (ObjectDisposedException) { }
                catch (Exception ex)
                {
                    if (!token.IsCancellationRequested)
                    {
                        Logger.LogError($"[POK-Bridge] RCON listener error: {ex.Message}");
                    }
                }
            }, token);
        }

        private async Task HandleClientAsync(TcpClient client, CancellationToken token)
        {
            using (client)
            {
                client.ReceiveTimeout = 10000;
                client.SendTimeout = 10000;
                var stream = client.GetStream();
                bool authenticated = false;

                try
                {
                    while (!token.IsCancellationRequested && client.Connected)
                    {
                        var sizeBuf = await ReadExactAsync(stream, 4, token);
                        if (sizeBuf == null) break;

                        int size = BitConverter.ToInt32(sizeBuf, 0);
                        if (size < 10 || size > 65536) break;

                        var payload = await ReadExactAsync(stream, size, token);
                        if (payload == null) break;

                        int id = BitConverter.ToInt32(payload, 0);
                        int type = BitConverter.ToInt32(payload, 4);
                        int bodyLen = Math.Max(0, size - 10);
                        string body = Encoding.UTF8.GetString(payload, 8, bodyLen);

                        if (type == SERVERDATA_AUTH)
                        {
                            if (body == _rconPassword)
                            {
                                authenticated = true;
                                await SendPacketAsync(stream, id, SERVERDATA_AUTH_RESPONSE, "", token);
                            }
                            else
                            {
                                await SendPacketAsync(stream, -1, SERVERDATA_AUTH_RESPONSE, "", token);
                                break;
                            }
                        }
                        else if (type == SERVERDATA_EXECCOMMAND)
                        {
                            if (!authenticated)
                            {
                                await SendPacketAsync(stream, -1, SERVERDATA_AUTH_RESPONSE, "", token);
                                break;
                            }

                            var tcs = new TaskCompletionSource<string>();
                            _mainThreadQueue.Enqueue(new PendingCommand { Command = body, Completion = tcs });

                            var completed = await Task.WhenAny(tcs.Task, Task.Delay(5000, token));
                            string response = completed == tcs.Task ? tcs.Task.Result : "Command timed out on game thread.";
                            await SendPacketAsync(stream, id, SERVERDATA_RESPONSE_VALUE, response, token);
                        }
                    }
                }
                catch { }
            }
        }

        private static async Task<byte[]> ReadExactAsync(NetworkStream stream, int count, CancellationToken token)
        {
            var buf = new byte[count];
            int offset = 0;
            while (offset < count)
            {
                int read = await stream.ReadAsync(buf, offset, count - offset, token);
                if (read <= 0) return null;
                offset += read;
            }
            return buf;
        }

        private static async Task SendPacketAsync(NetworkStream stream, int id, int type, string body, CancellationToken token)
        {
            var bodyBytes = Encoding.UTF8.GetBytes(body ?? "");
            int size = 4 + 4 + bodyBytes.Length + 2;
            var buf = new byte[4 + size];
            BitConverter.GetBytes(size).CopyTo(buf, 0);
            BitConverter.GetBytes(id).CopyTo(buf, 4);
            BitConverter.GetBytes(type).CopyTo(buf, 8);
            bodyBytes.CopyTo(buf, 12);
            buf[12 + bodyBytes.Length] = 0;
            buf[13 + bodyBytes.Length] = 0;
            await stream.WriteAsync(buf, 0, buf.Length, token);
            await stream.FlushAsync(token);
        }

        private string ExecuteOnMainThread(string raw)
        {
            var trimmed = (raw ?? "").Trim();
            if (string.IsNullOrEmpty(trimmed)) return "";

            int spaceIdx = trimmed.IndexOf(' ');
            string cmd = (spaceIdx >= 0 ? trimmed.Substring(0, spaceIdx) : trimmed).ToLowerInvariant();
            string arg = spaceIdx >= 0 ? trimmed.Substring(spaceIdx + 1).Trim() : "";

            switch (cmd)
            {
                case "help":
                    return "POK-Valheim Bridge Commands (100% Server-Side, Vanilla Clients Supported):\n" +
                           "  say <msg>       - Show center-screen banner to all players\n" +
                           "  top <msg>       - Show top-left HUD notification to all players\n" +
                           "  players / list  - List online players with IDs & live (X, Y, Z) coordinates\n" +
                           "  info            - World name, current Day, online count & ZDO count\n" +
                           "  save            - Trigger immediate world save\n" +
                           "  kick <name|id>  - Kick a player\n" +
                           "  ban <name|id>   - Ban a player\n" +
                           "  unban <id>      - Unban a player ID";

                case "say":
                case "announce":
                case "broadcast":
                    if (string.IsNullOrEmpty(arg)) return "Usage: say <message>";
                    return BroadcastHudMessage(2, arg); // 2 = MessageHud.MessageType.Center

                case "top":
                    if (string.IsNullOrEmpty(arg)) return "Usage: top <message>";
                    return BroadcastHudMessage(1, arg); // 1 = MessageHud.MessageType.TopLeft

                case "list":
                case "players":
                case "who":
                case "loc":
                case "pos":
                    return GetPlayersWithLocations();

                case "info":
                case "status":
                    return GetServerInfo();

                case "save":
                    return TriggerWorldSave();

                case "kick":
                    if (string.IsNullOrEmpty(arg)) return "Usage: kick <playerName or SteamID>";
                    return InvokeZNetModeration("Kick", arg);

                case "ban":
                    if (string.IsNullOrEmpty(arg)) return "Usage: ban <playerName or SteamID>";
                    return InvokeZNetModeration("Ban", arg);

                case "unban":
                    if (string.IsNullOrEmpty(arg)) return "Usage: unban <SteamID>";
                    return InvokeZNetModeration("Unban", arg);

                default:
                    return $"Unknown command '{cmd}'. Type 'help' for available POK-Valheim RCON commands.";
            }
        }

        private static Type FindGameType(string typeName)
        {
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                var t = asm.GetType(typeName, false);
                if (t != null) return t;
            }
            return null;
        }

        private static object GetSingleton(string typeName)
        {
            var t = FindGameType(typeName);
            if (t == null) return null;
            var prop = t.GetProperty("instance", BindingFlags.Public | BindingFlags.Static);
            if (prop != null) return prop.GetValue(null);
            var field = t.GetField("m_instance", BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.Static);
            return field?.GetValue(null);
        }

        private string BroadcastHudMessage(int messageType, string message)
        {
            var rpc = GetSingleton("ZRoutedRpc");
            if (rpc == null) return "ZRoutedRpc not initialized yet (world still loading).";

            var rpcType = rpc.GetType();
            var everybodyField = rpcType.GetField("Everybody", BindingFlags.Public | BindingFlags.Static);
            long everybody = everybodyField != null ? Convert.ToInt64(everybodyField.GetValue(null)) : 0L;

            var method = rpcType.GetMethod(
                "InvokeRoutedRPC",
                new[] { typeof(long), typeof(string), typeof(object[]) }
            );
            if (method == null) return "Could not locate ZRoutedRpc.InvokeRoutedRPC.";

            method.Invoke(rpc, new object[] { everybody, "ShowMessage", new object[] { messageType, message } });
            Logger.LogInfo($"[POK-Bridge] Broadcast (type={messageType}): {message}");
            return $"Broadcast sent to all players: \"{message}\"";
        }

        private string GetPlayersWithLocations()
        {
            var znet = GetSingleton("ZNet");
            if (znet == null) return "ZNet not initialized yet.";

            var getPeers = znet.GetType().GetMethod("GetPeers", BindingFlags.Public | BindingFlags.Instance);
            var peersObj = getPeers?.Invoke(znet, null) as IEnumerable;
            if (peersObj == null) return "No peers available.";

            var lines = new List<string>();
            int count = 0;
            foreach (var peer in peersObj)
            {
                count++;
                var pt = peer.GetType();
                string name = pt.GetField("m_playerName")?.GetValue(peer)?.ToString() ?? "Unknown";
                var socket = pt.GetField("m_socket")?.GetValue(peer);
                string hostId = socket?.GetType().GetMethod("GetHostName")?.Invoke(socket, null)?.ToString() ?? "?";

                var posObj = pt.GetField("m_refPos")?.GetValue(peer);
                string posStr = "unknown";
                if (posObj is Vector3 v)
                {
                    int dist = Mathf.RoundToInt(Mathf.Sqrt(v.x * v.x + v.z * v.z));
                    posStr = $"X:{Mathf.RoundToInt(v.x)}, Y:{Mathf.RoundToInt(v.y)}, Z:{Mathf.RoundToInt(v.z)} ({dist}m from spawn)";
                }

                lines.Add($"  {count}. {name} | ID: {hostId} | Pos: {posStr}");
            }

            if (count == 0) return "0 players currently online.";
            return $"Online Players ({count}):\n" + string.Join("\n", lines);
        }

        private string GetServerInfo()
        {
            var znet = GetSingleton("ZNet");
            if (znet == null) return "Server is still starting...";

            var zt = znet.GetType();
            string worldName = zt.GetMethod("GetWorldName")?.Invoke(znet, null)?.ToString() ?? "?";
            var peers = zt.GetMethod("GetPeers")?.Invoke(znet, null) as ICollection;
            int playerCount = peers?.Count ?? 0;

            string dayStr = "?";
            var envMan = GetSingleton("EnvMan");
            if (envMan != null)
            {
                var getDay = envMan.GetType().GetMethod("GetDay", Type.EmptyTypes);
                if (getDay != null) dayStr = getDay.Invoke(envMan, null)?.ToString() ?? "?";
            }

            string zdoStr = "?";
            var zdoMan = GetSingleton("ZDOMan");
            if (zdoMan != null)
            {
                var nrOfObjects = zdoMan.GetType().GetMethod("NrOfObjects", Type.EmptyTypes);
                if (nrOfObjects != null) zdoStr = nrOfObjects.Invoke(zdoMan, null)?.ToString() ?? "?";
            }

            return $"World: {worldName} | Day: {dayStr} | Players Online: {playerCount} | ZDOs: {zdoStr}";
        }

        private string TriggerWorldSave()
        {
            var znet = GetSingleton("ZNet");
            if (znet == null) return "ZNet not initialized yet.";
            var saveMethod = znet.GetType().GetMethod("Save", new[] { typeof(bool), typeof(bool), typeof(bool) });
            if (saveMethod != null)
            {
                saveMethod.Invoke(znet, new object[] { false, false, false });
                return "World save triggered!";
            }
            var saveMethod1 = znet.GetType().GetMethod("Save", new[] { typeof(bool) });
            if (saveMethod1 != null)
            {
                saveMethod1.Invoke(znet, new object[] { false });
                return "World save triggered!";
            }
            return "Could not find ZNet.Save method.";
        }

        private string InvokeZNetModeration(string methodName, string target)
        {
            var znet = GetSingleton("ZNet");
            if (znet == null) return "ZNet not initialized yet.";
            var m = znet.GetType().GetMethod(methodName, new[] { typeof(string) });
            if (m == null) return $"Method ZNet.{methodName} not found.";
            m.Invoke(znet, new object[] { target });
            return $"Executed {methodName} on '{target}'.";
        }
    }
}
