using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using BepInEx.Configuration;
using HarmonyLib;
using UnityEngine;

namespace POKValheimQoL
{
    public static class BuddyController
    {
        public static ConfigEntry<bool> EnableAiBuddy;
        public static ConfigEntry<string> BuddyBrainBaseUrl;
        public static ConfigEntry<string> BuddyName;
        public static ConfigEntry<KeyCode> SummonKey;

        private class BuddyTask
        {
            public string Action;
            public int Amount;
            public string ChestLabel;
        }

        private static readonly ConcurrentQueue<Action> _mainThreadQueue = new ConcurrentQueue<Action>();
        private static readonly Queue<BuddyTask> _taskQueue = new Queue<BuddyTask>();
        private static BuddyTask _activeTask;

        private static GameObject _buddyGo;
        private static Component _buddyChar;
        private static Component _buddyHumanoid;
        private static Component _buddyBaseAi;
        private static Component _buddyMonsterAi;

        private static int _axeDurability = 100;
        private static string _equippedAxePrefab = "";
        private static bool _axeBorrowedFromChest;
        private static string _equippedPickaxePrefab = "";
        private static bool _pickaxeBorrowedFromChest;
        private static Component _pendingToolChest;
        private static string _pendingToolPrefab;
        private static string _pendingToolDisplay;
        private static readonly Dictionary<string, int> _bag = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        private static float _nextSwingAt;
        private static float _nextScanAt;
        private static float _nextHealAt;
        private static Component _currentTargetResource;
        private static Component _currentTargetDrop;
        private static bool _isThinking;

        // Cached reflection
        private static Type _znetSceneType;
        private static PropertyInfo _znetSceneInstProp;
        private static MethodInfo _znetGetPrefabMethod;
        private static MethodInfo _znetDestroyMethod;
        private static Type _charType;
        private static FieldInfo _charNameField;
        private static FieldInfo _charFactionField;
        private static MethodInfo _charSetTamedMethod;
        private static MethodInfo _charSetMaxHpMethod;
        private static MethodInfo _charHealMethod;
        private static MethodInfo _charGetHpMethod;
        private static MethodInfo _charGetMaxHpMethod;
        private static Type _humanoidType;
        private static MethodInfo _humanoidStartAttackMethod;
        private static MethodInfo _humanoidGetVisEquipMethod;
        private static MethodInfo _visSetRightItemMethod;
        private static string _currentHandItem = "";
        private static Type _baseAiType;
        private static MethodInfo _baseAiMoveToMethod;
        private static MethodInfo _baseAiStopMovingMethod;
        private static Type _monsterAiType;
        private static MethodInfo _monsterAiSetFollowMethod;
        private static Type _treeBaseType;
        private static MethodInfo _treeBaseDamageMethod;
        private static Type _treeLogType;
        private static MethodInfo _treeLogDamageMethod;
        private static Type _destructibleType;
        private static MethodInfo _destructibleDamageMethod;
        private static Type _hitDataType;
        private static FieldInfo _hitDamageField;
        private static FieldInfo _hitToolTierField;
        private static FieldInfo _hitPointField;
        private static FieldInfo _hitDirField;
        private static FieldInfo _dmgChopField;
        private static FieldInfo _dmgPickaxeField;
        private static Type _itemDropType;
        private static FieldInfo _itemDropDataField;
        private static FieldInfo _itemDataStackField;
        private static Type _craftingStationType;
        private static FieldInfo _allStationsField;

        private static readonly Regex _replyRegex = new Regex("\"reply\"\\s*:\\s*\"((?:\\\\.|[^\"])*)\"", RegexOptions.Compiled);
        private static readonly Regex _taskBlockRegex = new Regex("\\{[^{}]*\"action\"\\s*:\\s*\"([^\"]+)\"[^{}]*\\}", RegexOptions.Compiled);
        private static readonly Regex _amountRegex = new Regex("\"amount\"\\s*:\\s*(\\d+)", RegexOptions.Compiled);
        private static readonly Regex _labelRegex = new Regex("\"chestLabel\"\\s*:\\s*\"((?:\\\\.|[^\"])*)\"", RegexOptions.Compiled);

        public static void Init(ConfigFile config, Harmony harmony)
        {
            EnableAiBuddy = config.Bind("5. AI Viking Buddy", "Enabled", true,
                "Enable the LLM-powered AI Viking companion (summon with LeftAlt + B or '/buddy spawn' in chat).");
            BuddyBrainBaseUrl = config.Bind("5. AI Viking Buddy", "ManagerBrainUrl", "http://192.168.1.193:8088",
                "URL of your POK-Valheim Manager hosting the AI Buddy Brain (/api/buddy/public/think).");
            BuddyName = config.Bind("5. AI Viking Buddy", "BuddyName", "Bjorn",
                "Name of your AI Viking companion (also used as chat trigger word, e.g. 'Bjorn chop 30 wood').");
            SummonKey = config.Bind("5. AI Viking Buddy", "SummonKey", KeyCode.B,
                "Key combined with LeftAlt to summon/teleport your AI Buddy.");

            CacheReflection();

            var sendText = AccessTools.Method("Chat:SendText");
            if (sendText != null)
            {
                try
                {
                    harmony.Patch(sendText, prefix: new HarmonyMethod(typeof(BuddyController), nameof(Chat_SendText_Prefix)));
                }
                catch { }
            }

            // Override MonsterAI.UpdateAI for our Buddy so vanilla idle/wander AI never fights our task movement!
            var updateAi = AccessTools.Method("MonsterAI:UpdateAI");
            if (updateAi != null)
            {
                try
                {
                    harmony.Patch(updateAi, prefix: new HarmonyMethod(typeof(BuddyController), nameof(MonsterAI_UpdateAI_Prefix)));
                }
                catch { }
            }

            // Auto-delete Buddy cleanly when the player who summoned him logs out or disconnects
            var gameLogout = AccessTools.Method("Game:Logout");
            if (gameLogout != null)
            {
                try
                {
                    harmony.Patch(gameLogout, prefix: new HarmonyMethod(typeof(BuddyController), nameof(Game_Logout_Prefix)));
                }
                catch { }
            }
        }

        private static void Game_Logout_Prefix()
        {
            DismissBuddy();
        }

        private static void CacheReflection()
        {
            _znetSceneType = AccessTools.TypeByName("ZNetScene");
            _znetSceneInstProp = _znetSceneType?.GetProperty("instance", BindingFlags.Public | BindingFlags.Static);
            _znetGetPrefabMethod = _znetSceneType?.GetMethod("GetPrefab", new[] { typeof(string) });
            _znetDestroyMethod = _znetSceneType?.GetMethod("Destroy", new[] { typeof(GameObject) });

            _charType = AccessTools.TypeByName("Character");
            _charNameField = _charType?.GetField("m_name", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
            _charFactionField = _charType?.GetField("m_faction", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
            _charSetTamedMethod = _charType?.GetMethod("SetTamed", new[] { typeof(bool) });
            _charSetMaxHpMethod = _charType?.GetMethod("SetMaxHealth", new[] { typeof(float) });
            _charHealMethod = _charType?.GetMethod("Heal", new[] { typeof(float), typeof(bool) });
            _charGetHpMethod = _charType?.GetMethod("GetHealth", Type.EmptyTypes);
            _charGetMaxHpMethod = _charType?.GetMethod("GetMaxHealth", Type.EmptyTypes);

            _humanoidType = AccessTools.TypeByName("Humanoid");
            _humanoidStartAttackMethod = _humanoidType?.GetMethod("StartAttack", new[] { _charType ?? typeof(object), typeof(bool) });
            _humanoidGetVisEquipMethod = _humanoidType?.GetMethod("GetVisEquipment", Type.EmptyTypes);
            var visType = AccessTools.TypeByName("VisEquipment");
            _visSetRightItemMethod = visType?.GetMethod("SetRightItem", new[] { typeof(string) });

            _baseAiType = AccessTools.TypeByName("BaseAI");
            _baseAiMoveToMethod = _baseAiType?.GetMethod("MoveTo", new[] { typeof(float), typeof(Vector3), typeof(float), typeof(bool) });
            _baseAiStopMovingMethod = _baseAiType?.GetMethod("StopMoving", Type.EmptyTypes);

            _monsterAiType = AccessTools.TypeByName("MonsterAI");
            _monsterAiSetFollowMethod = _monsterAiType?.GetMethod("SetFollowTarget", new[] { typeof(GameObject) });

            _treeBaseType = AccessTools.TypeByName("TreeBase");
            _treeBaseDamageMethod = _treeBaseType?.GetMethod("Damage");
            _treeLogType = AccessTools.TypeByName("TreeLog");
            _treeLogDamageMethod = _treeLogType?.GetMethod("Damage");
            _destructibleType = AccessTools.TypeByName("Destructible");
            _destructibleDamageMethod = _destructibleType?.GetMethod("Damage");

            _hitDataType = AccessTools.TypeByName("HitData");
            _hitDamageField = _hitDataType?.GetField("m_damage");
            _hitToolTierField = _hitDataType?.GetField("m_toolTier");
            _hitPointField = _hitDataType?.GetField("m_point");
            _hitDirField = _hitDataType?.GetField("m_dir");
            if (_hitDamageField != null)
            {
                _dmgChopField = _hitDamageField.FieldType.GetField("m_chop");
                _dmgPickaxeField = _hitDamageField.FieldType.GetField("m_pickaxe");
            }

            _itemDropType = AccessTools.TypeByName("ItemDrop");
            _itemDropDataField = _itemDropType?.GetField("m_itemData");
            var itemDataType = AccessTools.TypeByName("ItemDrop+ItemData");
            _itemDataStackField = itemDataType?.GetField("m_stack");

            _craftingStationType = AccessTools.TypeByName("CraftingStation");
            _allStationsField = _craftingStationType?.GetField("m_allStations", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static);
        }

        private static void EquipVisualTool(string itemPrefabName)
        {
            if (_buddyHumanoid == null || _humanoidGetVisEquipMethod == null || _visSetRightItemMethod == null) return;
            if (_currentHandItem == itemPrefabName) return;
            try
            {
                var vis = _humanoidGetVisEquipMethod.Invoke(_buddyHumanoid, null);
                if (vis != null)
                {
                    _visSetRightItemMethod.Invoke(vis, new object[] { itemPrefabName });
                    _currentHandItem = itemPrefabName;
                }
            }
            catch { }
        }

        private static string GetName() => string.IsNullOrWhiteSpace(BuddyName?.Value) ? "Bjorn" : BuddyName.Value.Trim();

        public static void Tick()
        {
            if (EnableAiBuddy == null || !EnableAiBuddy.Value) return;

            // Drain async LLM responses on Unity main thread
            while (_mainThreadQueue.TryDequeue(out var act))
            {
                try { act(); } catch { }
            }

            // Alt + B summons/teleports the AI Buddy
            if ((Input.GetKey(KeyCode.LeftAlt) || Input.GetKey(KeyCode.RightAlt)) && Input.GetKeyDown(SummonKey.Value))
            {
                SummonOrTeleportBuddy();
            }
        }

        // Runs inside Valheim's FixedUpdate AI tick — completely replaces vanilla Dverger wander/idle while executing tasks!
        private static bool MonsterAI_UpdateAI_Prefix(object __instance, float __0, ref bool __result)
        {
            if (_buddyMonsterAi == null || !ReferenceEquals(__instance, _buddyMonsterAi))
                return true;

            if (_buddyGo == null) return true;

            // Let vanilla MonsterAI handle combat when in "guard" mode
            if (_activeTask != null && _activeTask.Action == "guard")
                return true;

            try
            {
                TickBuddyBrain(__0 > 0f ? __0 : Time.fixedDeltaTime);
            }
            catch { }

            __result = true;
            return false; // Skip vanilla MonsterAI idle/wander so it NEVER paces back and forth!
        }

        private static void Chat_SendText_Prefix(object __0, string __1)
        {
            if (EnableAiBuddy == null || !EnableAiBuddy.Value || string.IsNullOrWhiteSpace(__1)) return;
            string text = __1.Trim();
            string lower = text.ToLowerInvariant();
            string bName = GetName().ToLowerInvariant();

            if (lower == "/buddy" || lower == "/buddy spawn" || lower == $"/{bName}")
            {
                _mainThreadQueue.Enqueue(SummonOrTeleportBuddy);
                return;
            }
            if (lower == "/buddy dismiss" || lower == "/buddy despawn")
            {
                _mainThreadQueue.Enqueue(DismissBuddy);
                return;
            }

            bool addressed = lower.StartsWith("buddy ") || lower.StartsWith("buddy,") ||
                             lower.StartsWith("@buddy ") || lower.StartsWith(bName + " ") ||
                             lower.StartsWith(bName + ",") || lower.StartsWith("@" + bName + " ");
            if (!addressed) return;

            string command = text;
            int idx = text.IndexOf(' ');
            if (idx > 0 && idx < text.Length - 1)
                command = text.Substring(idx + 1).Trim();

            _mainThreadQueue.Enqueue(() =>
            {
                if (_buddyGo == null) SummonOrTeleportBuddy();
                AskBrainAsync(command);
            });
        }

        public static void SummonOrTeleportBuddy()
        {
            var player = QoLPlugin.GetLocalPlayerPublic();
            if (player == null) return;

            Vector3 spawnPos = player.transform.position + player.transform.forward * 2.5f + Vector3.up * 0.5f;

            if (_buddyGo != null)
            {
                _buddyGo.transform.position = spawnPos;
                _activeTask = new BuddyTask { Action = "follow" };
                _taskQueue.Clear();
                QoLPlugin.ShowHudMessagePublic($"[{GetName()}] Right beside you! Type 'buddy <task>' in chat.");
                return;
            }

            try
            {
                // Clean up any leftover orphaned AI Buddy NPC from a previous session before spawning
                CleanupOrphanBuddies(player.transform.position, 80f);

                var znet = _znetSceneInstProp?.GetValue(null);
                if (znet == null || _znetGetPrefabMethod == null) return;

                var prefab = _znetGetPrefabMethod.Invoke(znet, new object[] { "Dverger" }) as GameObject
                          ?? _znetGetPrefabMethod.Invoke(znet, new object[] { "DvergerMage" }) as GameObject;
                if (prefab == null)
                {
                    QoLPlugin.ShowHudMessagePublic("[POK-Buddy] Could not find Dverger prefab to spawn Buddy.");
                    return;
                }

                _buddyGo = UnityEngine.Object.Instantiate(prefab, spawnPos, Quaternion.identity);
                _buddyChar = _charType != null ? _buddyGo.GetComponent(_charType) : null;
                _buddyHumanoid = _humanoidType != null ? _buddyGo.GetComponent(_humanoidType) : null;
                _buddyBaseAi = _baseAiType != null ? _buddyGo.GetComponent(_baseAiType) : null;
                _buddyMonsterAi = _monsterAiType != null ? _buddyGo.GetComponent(_monsterAiType) : null;

                if (_buddyChar != null)
                {
                    _charNameField?.SetValue(_buddyChar, $"{GetName()} (AI Buddy)");
                    if (_charFactionField != null)
                    {
                        try
                        {
                            var playersFaction = Enum.Parse(_charFactionField.FieldType, "Players");
                            _charFactionField.SetValue(_buddyChar, playersFaction);
                        }
                        catch { }
                    }
                    _charSetTamedMethod?.Invoke(_buddyChar, new object[] { true });
                    _charSetMaxHpMethod?.Invoke(_buddyChar, new object[] { 500f });
                    _charHealMethod?.Invoke(_buddyChar, new object[] { 500f, false });
                }

                _monsterAiSetFollowMethod?.Invoke(_buddyMonsterAi, new object[] { player.gameObject });
                _currentHandItem = "INIT";
                _equippedAxePrefab = "";
                _axeBorrowedFromChest = false;
                _equippedPickaxePrefab = "";
                _pickaxeBorrowedFromChest = false;
                _pendingToolChest = null;
                EquipVisualTool("");
                _axeDurability = 100;
                _activeTask = new BuddyTask { Action = "follow" };
                _taskQueue.Clear();
                QoLPlugin.ShowHudMessagePublic($"[{GetName()}] Summoned! Type 'buddy chop 20 wood and put it in the POK chest' in chat!");
            }
            catch (Exception ex)
            {
                QoLPlugin.ShowHudMessagePublic($"[POK-Buddy] Spawn error: {ex.Message}");
            }
        }

        private static void DestroyNetworkObject(GameObject go)
        {
            if (go == null) return;
            try
            {
                var nviewType = AccessTools.TypeByName("ZNetView");
                var nview = nviewType != null ? go.GetComponent(nviewType) : null;
                if (nview != null)
                {
                    nviewType.GetMethod("ClaimOwnership", Type.EmptyTypes)?.Invoke(nview, null);
                }
                var znet = _znetSceneInstProp?.GetValue(null);
                if (znet != null && _znetDestroyMethod != null)
                    _znetDestroyMethod.Invoke(znet, new object[] { go });
                else
                    UnityEngine.Object.Destroy(go);
            }
            catch { }
        }

        private static void CleanupOrphanBuddies(Vector3 origin, float radius)
        {
            if (_charType == null || _charNameField == null) return;
            try
            {
                foreach (var col in Physics.OverlapSphere(origin, radius))
                {
                    if (col == null) continue;
                    var ch = col.GetComponentInParent(_charType);
                    if (ch == null || ch.gameObject == _buddyGo) continue;
                    var name = _charNameField.GetValue(ch) as string ?? "";
                    if (name.IndexOf("(AI Buddy)", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        DestroyNetworkObject(ch.gameObject);
                    }
                }
            }
            catch { }
        }

        public static void DismissBuddy()
        {
            var player = QoLPlugin.GetLocalPlayerPublic();
            if (_buddyGo != null)
            {
                Vector3 pos = _buddyGo.transform.position;
                // Safely return any borrowed player tools before despawning so nothing is ever lost!
                if (_axeBorrowedFromChest && !string.IsNullOrEmpty(_equippedAxePrefab))
                    QoLPlugin.ReturnToolSafelyPublic(pos, _equippedAxePrefab);
                if (_pickaxeBorrowedFromChest && !string.IsNullOrEmpty(_equippedPickaxePrefab))
                    QoLPlugin.ReturnToolSafelyPublic(pos, _equippedPickaxePrefab);
                _equippedAxePrefab = "";
                _axeBorrowedFromChest = false;
                _equippedPickaxePrefab = "";
                _pickaxeBorrowedFromChest = false;
                _pendingToolChest = null;

                DestroyNetworkObject(_buddyGo);
                _buddyGo = null;
                _buddyChar = null;
                _buddyHumanoid = null;
                _buddyBaseAi = null;
                _buddyMonsterAi = null;
                _taskQueue.Clear();
                _activeTask = null;
                QoLPlugin.ShowHudMessagePublic($"[{GetName()}] Dismissed. Press Alt+B anytime to summon again.");
            }
            if (player != null)
            {
                CleanupOrphanBuddies(player.transform.position, 80f);
            }
        }

        private static string EscapeJson(string s)
        {
            return (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", " ").Replace("\r", " ");
        }

        private static int GetBagCount(string key) => _bag.TryGetValue(key, out int v) ? v : 0;

        private static void AskBrainAsync(string message)
        {
            if (_isThinking)
            {
                QoLPlugin.ShowHudMessagePublic($"[{GetName()}] Still thinking about your last order...");
                return;
            }
            _isThinking = true;

            var player = QoLPlugin.GetLocalPlayerPublic();
            string baseUrl = (BuddyBrainBaseUrl.Value ?? "http://192.168.1.193:8088").TrimEnd('/');
            string url = baseUrl + "/api/buddy/public/think";

            float hp = _buddyChar != null && _charGetHpMethod?.Invoke(_buddyChar, null) is float h ? h : 500f;
            float maxHp = _buddyChar != null && _charGetMaxHpMethod?.Invoke(_buddyChar, null) is float mh ? mh : 500f;
            bool hasBench = FindNearestStation(_buddyGo.transform.position, 45f) != null;
            var chestLabels = QoLPlugin.GetNearbyChestLabelsPublic(_buddyGo.transform.position, 45f);
            string chestsJson = "[" + string.Join(",", chestLabels.Take(12).Select(c => "\"" + EscapeJson(c) + "\"")) + "]";

            string body = "{" +
                $"\"playerName\":\"{EscapeJson(player?.name ?? "Viking")}\"," +
                $"\"message\":\"{EscapeJson(message)}\"," +
                "\"state\":{" +
                    $"\"hp\":{(int)hp},\"maxHp\":{(int)maxHp}," +
                    $"\"axeDurability\":{_axeDurability}," +
                    $"\"bagWood\":{GetBagCount("Wood")}," +
                    $"\"bagStone\":{GetBagCount("Stone")}," +
                    $"\"bagOre\":{GetBagCount("CopperOre") + GetBagCount("TinOre")}," +
                    $"\"currentTask\":\"{EscapeJson(_activeTask?.Action ?? "idle")}\"," +
                    $"\"nearbyWorkbench\":{(hasBench ? "true" : "false")}," +
                    $"\"nearbyChests\":{chestsJson}" +
                "}}";

            QoLPlugin.ShowHudMessagePublic($"[{GetName()}] Thinking...");

            ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    var req = (HttpWebRequest)WebRequest.Create(url);
                    req.Method = "POST";
                    req.ContentType = "application/json";
                    req.Timeout = 20000;
                    byte[] bytes = Encoding.UTF8.GetBytes(body);
                    req.ContentLength = bytes.Length;
                    using (var s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);

                    string respJson;
                    using (var resp = (HttpWebResponse)req.GetResponse())
                    using (var reader = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                    {
                        respJson = reader.ReadToEnd();
                    }

                    string reply = "On it!";
                    var rm = _replyRegex.Match(respJson);
                    if (rm.Success) reply = Regex.Unescape(rm.Groups[1].Value);

                    var parsedTasks = new List<BuddyTask>();
                    foreach (Match m in _taskBlockRegex.Matches(respJson))
                    {
                        string block = m.Value;
                        string action = m.Groups[1].Value;
                        int amt = 25;
                        var am = _amountRegex.Match(block);
                        if (am.Success && int.TryParse(am.Groups[1].Value, out int parsedAmt)) amt = parsedAmt;
                        string lbl = "";
                        var lm = _labelRegex.Match(block);
                        if (lm.Success) lbl = Regex.Unescape(lm.Groups[1].Value);
                        parsedTasks.Add(new BuddyTask { Action = action, Amount = amt, ChestLabel = lbl });
                    }

                    _mainThreadQueue.Enqueue(() =>
                    {
                        _isThinking = false;
                        _taskQueue.Clear();
                        foreach (var t in parsedTasks) _taskQueue.Enqueue(t);
                        _activeTask = _taskQueue.Count > 0 ? _taskQueue.Dequeue() : new BuddyTask { Action = "follow" };
                        _currentTargetResource = null;
                        _currentTargetDrop = null;
                        QoLPlugin.ShowHudMessagePublic($"[{GetName()}] {reply}");
                    });
                }
                catch (Exception ex)
                {
                    _mainThreadQueue.Enqueue(() =>
                    {
                        _isThinking = false;
                        QoLPlugin.ShowHudMessagePublic($"[{GetName()}] Brain offline ({ex.Message}); using local follow.");
                        _activeTask = new BuddyTask { Action = "follow" };
                    });
                }
            });
        }

        private static void AdvanceTask(string doneMessage = null)
        {
            _currentTargetResource = null;
            _currentTargetDrop = null;
            if (!string.IsNullOrEmpty(doneMessage))
                QoLPlugin.ShowHudMessagePublic($"[{GetName()}] {doneMessage}");
            _activeTask = _taskQueue.Count > 0 ? _taskQueue.Dequeue() : new BuddyTask { Action = "follow" };
        }

        private static void MoveBuddyTo(float dt, Vector3 dest, float stopDist, bool run)
        {
            if (_baseAiMoveToMethod != null && _buddyBaseAi != null)
            {
                _baseAiMoveToMethod.Invoke(_buddyBaseAi, new object[] { dt, dest, stopDist, run });
            }
        }

        private static void TickBuddyBrain(float dt)
        {
            var player = QoLPlugin.GetLocalPlayerPublic();
            if (player == null) return;

            // Gentle passive regen so buddy survives stray hits
            if (Time.unscaledTime > _nextHealAt && _buddyChar != null)
            {
                _nextHealAt = Time.unscaledTime + 3f;
                _charHealMethod?.Invoke(_buddyChar, new object[] { 8f, false });
            }

            if (_activeTask == null) _activeTask = new BuddyTask { Action = "follow" };
            Vector3 bPos = _buddyGo.transform.position;

            switch (_activeTask.Action)
            {
                case "stay":
                    _monsterAiSetFollowMethod?.Invoke(_buddyMonsterAi, new object[] { null });
                    _baseAiStopMovingMethod?.Invoke(_buddyBaseAi, null);
                    break;

                case "guard":
                    _monsterAiSetFollowMethod?.Invoke(_buddyMonsterAi, new object[] { player.gameObject });
                    break;

                case "come":
                case "follow":
                {
                    _monsterAiSetFollowMethod?.Invoke(_buddyMonsterAi, new object[] { player.gameObject });
                    float dist = Vector3.Distance(bPos, player.transform.position);
                    if (dist > 55f)
                    {
                        _buddyGo.transform.position = player.transform.position + player.transform.forward * 2.5f + Vector3.up * 0.5f;
                    }
                    else if (dist > 3.2f)
                    {
                        MoveBuddyTo(dt, player.transform.position, 2.5f, dist > 6.5f);
                    }
                    else
                    {
                        _baseAiStopMovingMethod?.Invoke(_buddyBaseAi, null);
                        if (_activeTask.Action == "come") AdvanceTask("I'm here!");
                    }
                    break;
                }

                case "repair":
                {
                    _monsterAiSetFollowMethod?.Invoke(_buddyMonsterAi, new object[] { null });
                    var station = FindNearestStation(bPos, 50f);
                    if (station == null)
                    {
                        _axeDurability = 100;
                        AdvanceTask("No Workbench nearby — sharpened my axe by hand!");
                        return;
                    }
                    float dist = Vector3.Distance(bPos, station.transform.position);
                    if (dist > 2.6f)
                    {
                        MoveBuddyTo(dt, station.transform.position, 2.2f, true);
                    }
                    else
                    {
                        _baseAiStopMovingMethod?.Invoke(_buddyBaseAi, null);
                        _axeDurability = 100;
                        AdvanceTask("Repaired my tools at the Workbench!");
                    }
                    break;
                }

                case "harvest_wood":
                    TickHarvest(dt, isWood: true);
                    break;

                case "harvest_stone":
                    TickHarvest(dt, isWood: false);
                    break;

                case "deposit":
                    TickDeposit(dt);
                    break;
            }
        }

        private static float FlatDist(Vector3 a, Vector3 b)
        {
            float dx = a.x - b.x;
            float dz = a.z - b.z;
            return Mathf.Sqrt(dx * dx + dz * dz);
        }

        private static void TickHarvest(float dt, bool isWood)
        {
            _monsterAiSetFollowMethod?.Invoke(_buddyMonsterAi, new object[] { null });
            Vector3 bPos = _buddyGo.transform.position;

            // 0. Make sure Buddy actually grabs a real Axe/Pickaxe from a chest (or crafts a basic one) first!
            string currentTool = isWood ? _equippedAxePrefab : _equippedPickaxePrefab;
            if (string.IsNullOrEmpty(currentTool))
            {
                if (_pendingToolChest == null)
                {
                    if (QoLPlugin.FindBestToolChestPublic(bPos, 55f, isWood, out var tc, out var tp, out var td))
                    {
                        _pendingToolChest = tc;
                        _pendingToolPrefab = tp;
                        _pendingToolDisplay = td;
                        QoLPlugin.ShowHudMessagePublic($"[{GetName()}] Heading to chest to grab {td}...");
                    }
                    else
                    {
                        // No tool in any nearby chest -> craft a basic starter tool and hold it visibly!
                        string crafted = isWood ? "AxeStone" : "PickaxeAntler";
                        if (isWood) { _equippedAxePrefab = crafted; _axeBorrowedFromChest = false; }
                        else { _equippedPickaxePrefab = crafted; _pickaxeBorrowedFromChest = false; }
                        EquipVisualTool(crafted);
                        QoLPlugin.ShowHudMessagePublic($"[{GetName()}] No {(isWood ? "axe" : "pickaxe")} in chests — crafted a {(isWood ? "Stone Axe" : "Antler Pickaxe")}!");
                        return;
                    }
                }

                if (_pendingToolChest != null && _pendingToolChest.gameObject)
                {
                    float dChest = FlatDist(bPos, _pendingToolChest.transform.position);
                    if (dChest > 2.5f)
                    {
                        MoveBuddyTo(dt, _pendingToolChest.transform.position, 2.0f, true);
                        return;
                    }
                    _baseAiStopMovingMethod?.Invoke(_buddyBaseAi, null);
                    bool took = QoLPlugin.TakeToolFromChestPublic(_pendingToolChest, _pendingToolPrefab);
                    string finalTool = took ? _pendingToolPrefab : (isWood ? "AxeStone" : "PickaxeAntler");
                    if (isWood) { _equippedAxePrefab = finalTool; _axeBorrowedFromChest = took; }
                    else { _equippedPickaxePrefab = finalTool; _pickaxeBorrowedFromChest = took; }
                    EquipVisualTool(finalTool);
                    QoLPlugin.ShowHudMessagePublic(took
                        ? $"[{GetName()}] Grabbed {_pendingToolDisplay} from chest!"
                        : $"[{GetName()}] Crafted a {(isWood ? "Stone Axe" : "Antler Pickaxe")}!");
                    _pendingToolChest = null;
                    return;
                }
            }

            EquipVisualTool(currentTool);
            int targetAmt = Math.Max(5, _activeTask.Amount);
            int have = isWood
                ? GetBagCount("Wood") + GetBagCount("FineWood") + GetBagCount("CoreWood")
                : GetBagCount("Stone") + GetBagCount("CopperOre") + GetBagCount("TinOre");

            if (have >= targetAmt)
            {
                AdvanceTask($"Gathered {have} {(isWood ? "wood" : "stone/ore")}!");
                return;
            }

            if (_axeDurability <= 5)
            {
                var remaining = new Queue<BuddyTask>();
                remaining.Enqueue(_activeTask);
                while (_taskQueue.Count > 0) remaining.Enqueue(_taskQueue.Dequeue());
                _taskQueue.Clear();
                foreach (var t in remaining) _taskQueue.Enqueue(t);
                _activeTask = new BuddyTask { Action = "repair" };
                QoLPlugin.ShowHudMessagePublic($"[{GetName()}] My axe is worn out — heading to repair!");
                return;
            }

            // 1. Pick up nearby dropped wood/stone first!
            if (_currentTargetDrop == null && Time.unscaledTime > _nextScanAt)
            {
                _currentTargetDrop = FindNearestResourceDrop(bPos, 16f, isWood);
            }
            if (_currentTargetDrop != null && _currentTargetDrop.gameObject)
            {
                float d = FlatDist(bPos, _currentTargetDrop.transform.position);
                if (d > 2.2f)
                {
                    MoveBuddyTo(dt, _currentTargetDrop.transform.position, 1.5f, true);
                }
                else
                {
                    CollectDrop(_currentTargetDrop);
                    _currentTargetDrop = null;
                    int nowHave = isWood
                        ? GetBagCount("Wood") + GetBagCount("FineWood") + GetBagCount("CoreWood")
                        : GetBagCount("Stone") + GetBagCount("CopperOre") + GetBagCount("TinOre");
                    QoLPlugin.ShowHudMessagePublic($"[{GetName()}] Collected {(isWood ? "Wood" : "Stone")} ({nowHave}/{targetAmt})");
                }
                return;
            }

            // 2. Find nearest tree or rock
            if ((_currentTargetResource == null || !_currentTargetResource.gameObject) && Time.unscaledTime > _nextScanAt)
            {
                _nextScanAt = Time.unscaledTime + 0.6f;
                _currentTargetResource = isWood ? FindNearestTree(bPos, 60f) : FindNearestRock(bPos, 60f);
                if (_currentTargetResource == null)
                {
                    AdvanceTask($"Couldn't find any {(isWood ? "trees" : "rocks")} within 60m (gathered {have}).");
                    return;
                }
                float td = FlatDist(bPos, _currentTargetResource.transform.position);
                QoLPlugin.ShowHudMessagePublic($"[{GetName()}] Heading to {(isWood ? "tree" : "rock")} ({td:0}m away)...");
            }

            if (_currentTargetResource == null || !_currentTargetResource.gameObject) return;

            Vector3 rPos = _currentTargetResource.transform.position;
            float dist = FlatDist(bPos, rPos);
            if (dist > 3.2f)
            {
                MoveBuddyTo(dt, rPos, 2.4f, true);
            }
            else
            {
                _baseAiStopMovingMethod?.Invoke(_buddyBaseAi, null);
                Vector3 look = rPos - bPos;
                look.y = 0;
                if (look.sqrMagnitude > 0.01f)
                    _buddyGo.transform.rotation = Quaternion.Slerp(_buddyGo.transform.rotation, Quaternion.LookRotation(look), dt * 8f);

                if (Time.unscaledTime >= _nextSwingAt)
                {
                    _nextSwingAt = Time.unscaledTime + 1.25f;
                    _humanoidStartAttackMethod?.Invoke(_buddyHumanoid, new object[] { null, false });
                    ApplyResourceHit(_currentTargetResource, isWood, rPos, look.normalized);
                    _axeDurability = Math.Max(0, _axeDurability - 2);
                }
            }
        }

        private static void TickDeposit(float dt)
        {
            _monsterAiSetFollowMethod?.Invoke(_buddyMonsterAi, new object[] { null });
            int totalItems = _bag.Values.Sum();
            if (totalItems <= 0)
            {
                AdvanceTask("My bag is already empty!");
                return;
            }

            Vector3 bPos = _buddyGo.transform.position;
            var chest = QoLPlugin.FindBestBuddyDepositChestPublic(bPos, 50f, _activeTask.ChestLabel);
            if (chest == null)
            {
                AdvanceTask("No chest with space found nearby — holding onto the loot!");
                return;
            }

            float dist = Vector3.Distance(bPos, chest.transform.position);
            if (dist > 2.5f)
            {
                MoveBuddyTo(dt, chest.transform.position, 2.0f, true);
            }
            else
            {
                _baseAiStopMovingMethod?.Invoke(_buddyBaseAi, null);
                int deposited = QoLPlugin.DepositBuddyBagToChestPublic(chest, _bag);
                AdvanceTask(deposited > 0 ? $"Deposited {deposited} item(s) into the chest!" : "Chest was full — keeping items safe!");
            }
        }

        private static void ApplyResourceHit(Component target, bool isWood, Vector3 hitPoint, Vector3 dir)
        {
            if (_hitDataType == null || _hitDamageField == null) return;
            try
            {
                var hit = Activator.CreateInstance(_hitDataType);
                var dmg = _hitDamageField.GetValue(hit);
                if (isWood && _dmgChopField != null) _dmgChopField.SetValue(dmg, 40f);
                if (!isWood && _dmgPickaxeField != null) _dmgPickaxeField.SetValue(dmg, 40f);
                _hitDamageField.SetValue(hit, dmg);
                _hitToolTierField?.SetValue(hit, (short)2);
                _hitPointField?.SetValue(hit, hitPoint + Vector3.up * 0.8f);
                _hitDirField?.SetValue(hit, dir);

                var t = target.GetType();
                if (t == _treeBaseType) _treeBaseDamageMethod?.Invoke(target, new[] { hit });
                else if (t == _treeLogType) _treeLogDamageMethod?.Invoke(target, new[] { hit });
                else if (t == _destructibleType) _destructibleDamageMethod?.Invoke(target, new[] { hit });
            }
            catch { }
        }

        private static void CollectDrop(Component drop)
        {
            try
            {
                var itemData = _itemDropDataField?.GetValue(drop);
                int stack = _itemDataStackField?.GetValue(itemData) is int s ? s : 1;
                string prefabKey = drop.gameObject.name.Replace("(Clone)", "").Trim();
                _bag[prefabKey] = GetBagCount(prefabKey) + stack;

                var znet = _znetSceneInstProp?.GetValue(null);
                if (znet != null && _znetDestroyMethod != null)
                    _znetDestroyMethod.Invoke(znet, new object[] { drop.gameObject });
                else
                    UnityEngine.Object.Destroy(drop.gameObject);
            }
            catch { }
        }

        private static Component FindNearestStation(Vector3 origin, float radius)
        {
            var all = _allStationsField?.GetValue(null) as IEnumerable;
            if (all == null) return null;
            Component best = null;
            float bestSq = radius * radius;
            foreach (var obj in all)
            {
                var c = obj as Component;
                if (c == null || !c.gameObject) continue;
                float dSq = (c.transform.position - origin).sqrMagnitude;
                if (dSq < bestSq) { bestSq = dSq; best = c; }
            }
            return best;
        }

        private static Component FindNearestTree(Vector3 origin, float radius)
        {
            Component best = null;
            float bestSq = radius * radius;
            foreach (var col in Physics.OverlapSphere(origin, radius))
            {
                if (col == null) continue;
                Component comp = (_treeLogType != null ? col.GetComponentInParent(_treeLogType) : null)
                              ?? (_treeBaseType != null ? col.GetComponentInParent(_treeBaseType) : null);
                if (comp == null) continue;
                float dSq = (comp.transform.position - origin).sqrMagnitude;
                if (dSq < bestSq) { bestSq = dSq; best = comp; }
            }
            return best;
        }

        private static Component FindNearestRock(Vector3 origin, float radius)
        {
            Component best = null;
            float bestSq = radius * radius;
            foreach (var col in Physics.OverlapSphere(origin, radius))
            {
                if (col == null || _destructibleType == null) continue;
                var comp = col.GetComponentInParent(_destructibleType);
                if (comp == null) continue;
                string n = comp.gameObject.name.ToLowerInvariant();
                if (!n.Contains("rock") && !n.Contains("stone") && !n.Contains("copper") && !n.Contains("tin") && !n.Contains("mine"))
                    continue;
                float dSq = (comp.transform.position - origin).sqrMagnitude;
                if (dSq < bestSq) { bestSq = dSq; best = comp; }
            }
            return best;
        }

        private static Component FindNearestResourceDrop(Vector3 origin, float radius, bool isWood)
        {
            Component best = null;
            float bestSq = radius * radius;
            if (_itemDropType == null) return null;
            foreach (var col in Physics.OverlapSphere(origin, radius))
            {
                if (col == null) continue;
                var drop = col.GetComponentInParent(_itemDropType);
                if (drop == null) continue;
                string n = drop.gameObject.name.ToLowerInvariant();
                bool match = isWood
                    ? (n.Contains("wood") && !n.Contains("shield") && !n.Contains("arrow"))
                    : (n.Contains("stone") || n.Contains("copperore") || n.Contains("tinore") || n.Contains("flint"));
                if (!match) continue;
                float dSq = (drop.transform.position - origin).sqrMagnitude;
                if (dSq < bestSq) { bestSq = dSq; best = drop; }
            }
            return best;
        }
    }
}
