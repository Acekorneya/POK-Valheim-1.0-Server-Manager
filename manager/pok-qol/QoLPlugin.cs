using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using BepInEx;
using BepInEx.Configuration;
using HarmonyLib;
using UnityEngine;

namespace POKValheimQoL
{
    [BepInPlugin("com.pok.valheim.qol", "POK-Valheim QoL (Drop-Off Chest & Craft From Chests)", "1.2.0")]
    public class QoLPlugin : BaseUnityPlugin
    {
        public const string DROPOFF_PREFAB_NAME = "pok_dropoff_chest";

        public static ConfigEntry<bool> EnableDropOffSort;
        public static ConfigEntry<bool> EnableCraftableDropOffChest;
        public static ConfigEntry<int> DropOffWoodCost;
        public static ConfigEntry<int> DropOffCopperCost;
        public static ConfigEntry<bool> AllowSignTagFallback;
        public static ConfigEntry<string> DropOffTag;
        public static ConfigEntry<float> DropOffRadius;
        public static ConfigEntry<bool> EnableQuickStackHotkey;
        public static ConfigEntry<KeyCode> QuickStackKey;
        public static ConfigEntry<bool> EnableCraftFromChests;
        public static ConfigEntry<float> CraftRadius;

        private Harmony _harmony;
        private static QoLPlugin _instance;
        private static GameObject _dropOffPrefab;

        // Fast tracked registries (eliminates Unity FindObjectsOfType lag!)
        private static readonly HashSet<Component> _trackedContainers = new HashSet<Component>();
        private static readonly HashSet<Component> _trackedSigns = new HashSet<Component>();

        // Cached reflection members (resolved once)
        private static Type _playerType;
        private static Type _containerType;
        private static Type _signType;
        private static FieldInfo _localPlayerField;
        private static FieldInfo _containerNviewField;
        private static MethodInfo _containerGetInvMethod;
        private static MethodInfo _containerIsInUseMethod;
        private static MethodInfo _containerSaveMethod;
        private static MethodInfo _signGetTextMethod;
        private static MethodInfo _playerGetInvMethod;

        // 0.35s nearby chest item-count cache so Hammer UI runs at 0ms overhead
        private static float _cacheExpiresAt = -1f;
        private static Vector3 _cacheOrigin;
        private static readonly Dictionary<string, int> _nearbyItemCounts = new Dictionary<string, int>();

        private void Awake()
        {
            _instance = this;

            EnableDropOffSort = Config.Bind("1. Drop-Off Auto-Sort", "Enabled", true,
                "When you close a POK Drop-Off Chest, items automatically sort into nearby chests that already contain matching items.");
            EnableCraftableDropOffChest = Config.Bind("1. Drop-Off Auto-Sort", "CraftableDropOffChest", true,
                "Adds the craftable 'POK Drop-Off Chest' to the Hammer build menu (Furniture tab).");
            DropOffWoodCost = Config.Bind("1. Drop-Off Auto-Sort", "FineWoodCost", 10,
                "Fine Wood required to build a POK Drop-Off Chest.");
            DropOffCopperCost = Config.Bind("1. Drop-Off Auto-Sort", "CopperCost", 4,
                "Copper ingots required to build a POK Drop-Off Chest.");
            AllowSignTagFallback = Config.Bind("1. Drop-Off Auto-Sort", "AllowSignTagFallback", true,
                "Also allow marking any normal chest as a drop-off chest using a nearby Sign containing SignTag.");
            DropOffTag = Config.Bind("1. Drop-Off Auto-Sort", "SignTag", "[DROPOFF]",
                "Optional Sign text (within 3m of a chest) if AllowSignTagFallback is enabled.");
            DropOffRadius = Config.Bind("1. Drop-Off Auto-Sort", "SortRadiusMeters", 20f,
                "Radius (in meters) to search for destination chests.");

            EnableQuickStackHotkey = Config.Bind("2. Quick-Stack Hotkey", "Enabled", true,
                "Press LeftAlt + QuickStackKey to automatically store matching inventory items (skipping hotbar & equipped gear) into nearby chests.");
            QuickStackKey = Config.Bind("2. Quick-Stack Hotkey", "Key", KeyCode.G,
                "Key combined with LeftAlt to quick-stack inventory to nearby chests.");

            EnableCraftFromChests = Config.Bind("3. Craft & Build From Chests", "Enabled", true,
                "Automatically count and pull crafting/building materials from nearby chests (respects all crafting station requirements).");
            CraftRadius = Config.Bind("3. Craft & Build From Chests", "RadiusMeters", 15f,
                "Radius (in meters) to pull crafting and building materials from nearby chests.");

            CacheReflection();
            _harmony = new Harmony("com.pok.valheim.qol");
            ApplyPatches();
            Logger.LogInfo("[POK-QoL] v1.2.0 Loaded! Zero-lag cached containers, strict station checks, craftable POK Drop-Off Chest.");
        }

        private void OnDestroy()
        {
            try { _harmony?.UnpatchSelf(); } catch { }
            _trackedContainers.Clear();
            _trackedSigns.Clear();
        }

        private static void CacheReflection()
        {
            _playerType = AccessTools.TypeByName("Player");
            _containerType = AccessTools.TypeByName("Container");
            _signType = AccessTools.TypeByName("Sign");

            _localPlayerField = _playerType?.GetField("m_localPlayer", BindingFlags.Public | BindingFlags.Static);
            _playerGetInvMethod = _playerType?.GetMethod("GetInventory");

            _containerNviewField = _containerType?.GetField("m_nview", BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.Instance);
            _containerGetInvMethod = _containerType?.GetMethod("GetInventory");
            _containerIsInUseMethod = _containerType?.GetMethod("IsInUse");
            _containerSaveMethod = _containerType?.GetMethod("Save", BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.Instance);

            _signGetTextMethod = _signType?.GetMethod("GetText");
        }

        private void Update()
        {
            if (!EnableQuickStackHotkey.Value) return;
            if ((Input.GetKey(KeyCode.LeftAlt) || Input.GetKey(KeyCode.RightAlt)) && Input.GetKeyDown(QuickStackKey.Value))
            {
                try
                {
                    QuickStackPlayerInventory();
                }
                catch (Exception ex)
                {
                    Logger.LogWarning($"[POK-QoL] Quick-Stack warning: {ex.Message}");
                }
            }
        }

        private void ApplyPatches()
        {
            try
            {
                // 0. Register craftable POK Drop-Off Chest prefab in ZNetScene
                var znetAwake = AccessTools.Method("ZNetScene:Awake");
                if (znetAwake != null)
                {
                    _harmony.Patch(znetAwake, postfix: new HarmonyMethod(typeof(QoLPlugin), nameof(ZNetScene_Awake_Postfix)));
                }

                // Track containers & signs without ever calling FindObjectsOfType
                var contAwake = AccessTools.Method("Container:Awake");
                if (contAwake != null)
                    _harmony.Patch(contAwake, postfix: new HarmonyMethod(typeof(QoLPlugin), nameof(Container_Awake_Postfix)));

                var contDestroy = AccessTools.Method("Container:OnDestroyed");
                if (contDestroy != null)
                    _harmony.Patch(contDestroy, postfix: new HarmonyMethod(typeof(QoLPlugin), nameof(Container_Destroy_Postfix)));

                var signAwake = AccessTools.Method("Sign:Awake");
                if (signAwake != null)
                    _harmony.Patch(signAwake, postfix: new HarmonyMethod(typeof(QoLPlugin), nameof(Sign_Awake_Postfix)));

                // 1. Drop-off chest auto-sort when closing a container
                var setInUse = AccessTools.Method("Container:SetInUse");
                if (setInUse != null)
                {
                    _harmony.Patch(setInUse, postfix: new HarmonyMethod(typeof(QoLPlugin), nameof(Container_SetInUse_Postfix)));
                }

                // 2. Craft & Build from nearby chests (Zero-Lag + Strict Crafting Station checks)
                var haveReqItems = AccessTools.Method("Player:HaveRequirementItems");
                if (haveReqItems != null)
                {
                    _harmony.Patch(haveReqItems, postfix: new HarmonyMethod(typeof(QoLPlugin), nameof(Player_HaveRequirementItems_Postfix)));
                }

                var pieceType = AccessTools.TypeByName("Piece");
                var reqModeType = AccessTools.TypeByName("Player+RequirementMode");
                if (pieceType != null && reqModeType != null)
                {
                    var haveReqPiece = AccessTools.Method("Player:HaveRequirements", new[] { pieceType, reqModeType });
                    if (haveReqPiece != null)
                    {
                        _harmony.Patch(haveReqPiece, postfix: new HarmonyMethod(typeof(QoLPlugin), nameof(Player_HaveRequirements_Piece_Postfix)));
                    }
                }

                var consumeRes = AccessTools.Method("Player:ConsumeResources");
                if (consumeRes != null)
                {
                    _harmony.Patch(consumeRes, prefix: new HarmonyMethod(typeof(QoLPlugin), nameof(Player_ConsumeResources_Prefix)));
                }
            }
            catch (Exception ex)
            {
                Logger.LogWarning($"[POK-QoL] Patch setup warning: {ex.Message}");
            }
        }

        private static void Container_Awake_Postfix(object __instance)
        {
            if (__instance is Component c)
            {
                _trackedContainers.Add(c);
                _cacheExpiresAt = -1f;
            }
        }

        private static void Container_Destroy_Postfix(object __instance)
        {
            if (__instance is Component c)
            {
                _trackedContainers.Remove(c);
                _cacheExpiresAt = -1f;
            }
        }

        private static void Sign_Awake_Postfix(object __instance)
        {
            if (__instance is Component c) _trackedSigns.Add(c);
        }

        // =========================================================================
        // 0. CRAFTABLE "POK DROP-OFF CHEST" REGISTRATION (Hammer -> Furniture)
        // =========================================================================

        private static int GetStableHashCode(string str)
        {
            unchecked
            {
                int hash1 = 5381;
                int hash2 = hash1;
                for (int i = 0; i < str.Length && str[i] != '\0'; i += 2)
                {
                    hash1 = ((hash1 << 5) + hash1) ^ str[i];
                    if (i == str.Length - 1 || str[i + 1] == '\0') break;
                    hash2 = ((hash2 << 5) + hash2) ^ str[i + 1];
                }
                return hash1 + hash2 * 1566083941;
            }
        }

        private static void ZNetScene_Awake_Postfix(object __instance)
        {
            if (!EnableCraftableDropOffChest.Value) return;
            try
            {
                var zt = __instance.GetType();
                var getPrefab = zt.GetMethod("GetPrefab", new[] { typeof(string) });
                var prefabsList = zt.GetField("m_prefabs")?.GetValue(__instance) as IList;
                var namedPrefabs = zt.GetField("m_namedPrefabs", BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.Instance)?.GetValue(__instance) as IDictionary;
                if (getPrefab == null || prefabsList == null || namedPrefabs == null) return;

                if (_dropOffPrefab == null)
                {
                    var woodChest = getPrefab.Invoke(__instance, new object[] { "piece_chest_wood" }) as GameObject;
                    if (woodChest == null) return;

                    var holder = new GameObject("POK_PrefabHolder");
                    holder.SetActive(false);
                    UnityEngine.Object.DontDestroyOnLoad(holder);

                    _dropOffPrefab = UnityEngine.Object.Instantiate(woodChest, holder.transform, false);
                    _dropOffPrefab.name = DROPOFF_PREFAB_NAME;

                    foreach (var renderer in _dropOffPrefab.GetComponentsInChildren<MeshRenderer>(true))
                    {
                        var mats = renderer.materials;
                        for (int i = 0; i < mats.Length; i++)
                        {
                            if (mats[i] != null && mats[i].HasProperty("_Color"))
                            {
                                mats[i].color = Color.Lerp(mats[i].color, new Color(0.95f, 0.58f, 0.25f, 1f), 0.38f);
                            }
                        }
                        renderer.materials = mats;
                    }

                    if (_containerType != null)
                    {
                        var contComp = _dropOffPrefab.GetComponent(_containerType);
                        contComp?.GetType().GetField("m_name")?.SetValue(contComp, "POK Drop-Off Chest");
                    }

                    var pieceType = AccessTools.TypeByName("Piece");
                    var reqType = AccessTools.TypeByName("Piece+Requirement");
                    var itemDropType = AccessTools.TypeByName("ItemDrop");
                    if (pieceType != null && reqType != null && itemDropType != null)
                    {
                        var pieceComp = _dropOffPrefab.GetComponent(pieceType);
                        if (pieceComp != null)
                        {
                            pieceType.GetField("m_name")?.SetValue(pieceComp, "POK Drop-Off Chest");
                            pieceType.GetField("m_description")?.SetValue(
                                pieceComp,
                                $"Dump loot inside and close to auto-sort into nearby matching chests ({DropOffRadius.Value:0}m)."
                            );

                            var reqList = new List<object>();

                            void AddReq(string prefabName, int amount)
                            {
                                if (amount <= 0) return;
                                var itemGo = getPrefab.Invoke(__instance, new object[] { prefabName }) as GameObject;
                                var itemDrop = itemGo?.GetComponent(itemDropType);
                                if (itemDrop == null) return;
                                var req = Activator.CreateInstance(reqType);
                                reqType.GetField("m_resItem")?.SetValue(req, itemDrop);
                                reqType.GetField("m_amount")?.SetValue(req, amount);
                                reqType.GetField("m_recover")?.SetValue(req, true);
                                reqList.Add(req);
                            }

                            AddReq("FineWood", DropOffWoodCost.Value);
                            AddReq("Copper", DropOffCopperCost.Value);

                            if (reqList.Count > 0)
                            {
                                var arr = Array.CreateInstance(reqType, reqList.Count);
                                for (int i = 0; i < reqList.Count; i++) arr.SetValue(reqList[i], i);
                                pieceType.GetField("m_resources")?.SetValue(pieceComp, arr);
                            }
                        }
                    }
                }

                int hash = GetStableHashCode(DROPOFF_PREFAB_NAME);
                if (!prefabsList.Contains(_dropOffPrefab))
                {
                    prefabsList.Add(_dropOffPrefab);
                }
                namedPrefabs[hash] = _dropOffPrefab;

                var hammerGo = getPrefab.Invoke(__instance, new object[] { "Hammer" }) as GameObject;
                var itemDropT = AccessTools.TypeByName("ItemDrop");
                if (hammerGo != null && itemDropT != null)
                {
                    var hammerDrop = hammerGo.GetComponent(itemDropT);
                    var itemData = hammerDrop?.GetType().GetField("m_itemData")?.GetValue(hammerDrop);
                    var shared = itemData?.GetType().GetField("m_shared")?.GetValue(itemData);
                    var pieceTable = shared?.GetType().GetField("m_buildPieces")?.GetValue(shared);
                    var pieces = pieceTable?.GetType().GetField("m_pieces")?.GetValue(pieceTable) as IList;
                    if (pieces != null && !pieces.Contains(_dropOffPrefab))
                    {
                        pieces.Add(_dropOffPrefab);
                        _instance?.Logger.LogInfo(
                            $"[POK-QoL] Registered craftable '{DROPOFF_PREFAB_NAME}' in Hammer menu ({DropOffWoodCost.Value} FineWood + {DropOffCopperCost.Value} Copper)."
                        );
                    }
                }
            }
            catch (Exception ex)
            {
                _instance?.Logger.LogWarning($"[POK-QoL] Failed to register craftable Drop-Off Chest: {ex.Message}");
            }
        }

        // =========================================================================
        // FAST CACHED HELPERS (Zero FindObjectsOfType!)
        // =========================================================================

        private static Component GetLocalPlayer()
        {
            return _localPlayerField?.GetValue(null) as Component;
        }

        private static void ShowHudMessage(string text)
        {
            try
            {
                var hudType = AccessTools.TypeByName("MessageHud");
                var hud = hudType?.GetProperty("instance", BindingFlags.Public | BindingFlags.Static)?.GetValue(null);
                var show = hudType?.GetMethod("ShowMessage");
                if (hud != null && show != null)
                {
                    show.Invoke(hud, new object[] { 1, text, 0, null });
                }
            }
            catch { }
        }

        private static List<Component> FindNearbyContainers(Vector3 origin, float radius, Component exclude = null)
        {
            var result = new List<Component>();
            float rSq = radius * radius;
            List<Component> dead = null;

            foreach (var comp in _trackedContainers)
            {
                if (comp == null || !comp.gameObject)
                {
                    if (dead == null) dead = new List<Component>();
                    dead.Add(comp);
                    continue;
                }
                if (comp == exclude) continue;
                if ((comp.transform.position - origin).sqrMagnitude > rSq) continue;

                var nview = _containerNviewField?.GetValue(comp);
                if (nview == null) continue;
                var isValid = nview.GetType().GetMethod("IsValid")?.Invoke(nview, null);
                if (isValid is bool b && !b) continue;

                var inUse = _containerIsInUseMethod?.Invoke(comp, null);
                if (inUse is bool u && u) continue;

                result.Add(comp);
            }

            if (dead != null)
            {
                foreach (var d in dead) _trackedContainers.Remove(d);
            }
            return result;
        }

        private static bool IsDropOffContainer(Component container)
        {
            if (container == null) return false;
            if (container.gameObject.name.StartsWith(DROPOFF_PREFAB_NAME, StringComparison.OrdinalIgnoreCase))
                return true;

            if (!AllowSignTagFallback.Value) return false;
            var tag = (DropOffTag.Value ?? "[DROPOFF]").Trim();
            if (string.IsNullOrEmpty(tag)) return false;

            const float rSq = 3.2f * 3.2f;
            List<Component> dead = null;
            foreach (var signComp in _trackedSigns)
            {
                if (signComp == null || !signComp.gameObject)
                {
                    if (dead == null) dead = new List<Component>();
                    dead.Add(signComp);
                    continue;
                }
                if ((container.transform.position - signComp.transform.position).sqrMagnitude > rSq) continue;
                var text = _signGetTextMethod?.Invoke(signComp, null)?.ToString() ?? "";
                if (text.IndexOf(tag, StringComparison.OrdinalIgnoreCase) >= 0) return true;
            }
            if (dead != null)
            {
                foreach (var d in dead) _trackedSigns.Remove(d);
            }
            return false;
        }

        private static object GetContainerInventory(Component container)
        {
            return _containerGetInvMethod?.Invoke(container, null);
        }

        private static List<object> GetAllItems(object inventory)
        {
            var list = new List<object>();
            var items = inventory?.GetType().GetMethod("GetAllItems")?.Invoke(inventory, null) as IEnumerable;
            if (items == null) return list;
            foreach (var item in items) list.Add(item);
            return list;
        }

        private static string GetItemSharedName(object item)
        {
            var shared = item?.GetType().GetField("m_shared")?.GetValue(item);
            return shared?.GetType().GetField("m_name")?.GetValue(shared)?.ToString() ?? "";
        }

        private static int GetItemStack(object item)
        {
            var val = item?.GetType().GetField("m_stack")?.GetValue(item);
            return val is int i ? i : 0;
        }

        private static bool InventoryHasItemNamed(object inventory, string sharedName)
        {
            foreach (var item in GetAllItems(inventory))
            {
                if (GetItemSharedName(item) == sharedName) return true;
            }
            return false;
        }

        private static void SaveContainer(Component container)
        {
            try { _containerSaveMethod?.Invoke(container, null); } catch { }
        }

        private static void RefreshNearbyItemCacheIfNeeded(Vector3 origin)
        {
            float now = Time.unscaledTime;
            if (now < _cacheExpiresAt && (_cacheOrigin - origin).sqrMagnitude < 1.0f)
                return;

            _cacheExpiresAt = now + 0.35f;
            _cacheOrigin = origin;
            _nearbyItemCounts.Clear();

            foreach (var chest in FindNearbyContainers(origin, CraftRadius.Value))
            {
                var inv = GetContainerInventory(chest);
                if (inv == null) continue;
                foreach (var item in GetAllItems(inv))
                {
                    string name = GetItemSharedName(item);
                    if (string.IsNullOrEmpty(name)) continue;
                    int stack = GetItemStack(item);
                    if (stack <= 0) continue;
                    if (_nearbyItemCounts.TryGetValue(name, out int cur))
                        _nearbyItemCounts[name] = cur + stack;
                    else
                        _nearbyItemCounts[name] = stack;
                }
            }
        }

        // =========================================================================
        // 1. DROP-OFF AUTO-SORT CHEST (Triggers when closing a Drop-Off Chest)
        // =========================================================================

        private static void Container_SetInUse_Postfix(object __instance, bool inUse)
        {
            _cacheExpiresAt = -1f;
            if (inUse || !EnableDropOffSort.Value) return;
            try
            {
                var container = __instance as Component;
                if (container == null || !IsDropOffContainer(container)) return;

                var srcInv = GetContainerInventory(container);
                if (srcInv == null) return;

                var srcItems = GetAllItems(srcInv).ToList();
                if (srcItems.Count == 0) return;

                var targets = FindNearbyContainers(container.transform.position, DropOffRadius.Value, container)
                    .Where(c => !IsDropOffContainer(c))
                    .ToList();

                int movedStacks = 0;
                var addItemMethod = srcInv.GetType().GetMethod("AddItem", new[] { srcItems[0].GetType() });
                var removeItemMethod = srcInv.GetType().GetMethod("RemoveItem", new[] { srcItems[0].GetType() });
                if (addItemMethod == null || removeItemMethod == null) return;

                foreach (var item in srcItems)
                {
                    string name = GetItemSharedName(item);
                    if (string.IsNullOrEmpty(name)) continue;

                    foreach (var target in targets)
                    {
                        var dstInv = GetContainerInventory(target);
                        if (dstInv == null || !InventoryHasItemNamed(dstInv, name)) continue;

                        var added = addItemMethod.Invoke(dstInv, new[] { item });
                        if (added is bool ok && ok)
                        {
                            removeItemMethod.Invoke(srcInv, new[] { item });
                            SaveContainer(target);
                            movedStacks++;
                            break;
                        }
                    }
                }

                if (movedStacks > 0)
                {
                    SaveContainer(container);
                    _cacheExpiresAt = -1f;
                    ShowHudMessage($"[POK-QoL] Auto-sorted {movedStacks} stack(s) into nearby chests!");
                }
            }
            catch (Exception ex)
            {
                _instance?.Logger.LogWarning($"[POK-QoL] Drop-Off Sort warning: {ex.Message}");
            }
        }

        // =========================================================================
        // 2. QUICK-STACK HOTKEY (Alt + G)
        // =========================================================================

        private static void QuickStackPlayerInventory()
        {
            var player = GetLocalPlayer();
            if (player == null) return;

            var playerInv = _playerGetInvMethod?.Invoke(player, null);
            if (playerInv == null) return;

            var items = GetAllItems(playerInv).ToList();
            if (items.Count == 0) return;

            var targets = FindNearbyContainers(player.transform.position, DropOffRadius.Value)
                .Where(c => !IsDropOffContainer(c))
                .ToList();
            if (targets.Count == 0)
            {
                ShowHudMessage("[POK-QoL] No nearby chests found to quick-stack into.");
                return;
            }

            var addItemMethod = playerInv.GetType().GetMethod("AddItem", new[] { items[0].GetType() });
            var removeItemMethod = playerInv.GetType().GetMethod("RemoveItem", new[] { items[0].GetType() });
            if (addItemMethod == null || removeItemMethod == null) return;

            int moved = 0;
            foreach (var item in items)
            {
                var equipped = item.GetType().GetField("m_equipped")?.GetValue(item);
                if (equipped is bool eq && eq) continue;
                var gridPos = item.GetType().GetField("m_gridPos")?.GetValue(item);
                var gridY = gridPos?.GetType().GetField("y")?.GetValue(gridPos);
                if (gridY is int gy && gy == 0) continue;

                string name = GetItemSharedName(item);
                if (string.IsNullOrEmpty(name)) continue;

                foreach (var target in targets)
                {
                    var dstInv = GetContainerInventory(target);
                    if (dstInv == null || !InventoryHasItemNamed(dstInv, name)) continue;

                    var added = addItemMethod.Invoke(dstInv, new[] { item });
                    if (added is bool ok && ok)
                    {
                        removeItemMethod.Invoke(playerInv, new[] { item });
                        SaveContainer(target);
                        moved++;
                        break;
                    }
                }
            }

            _cacheExpiresAt = -1f;
            ShowHudMessage(moved > 0
                ? $"[POK-QoL] Quick-stacked {moved} stack(s) into nearby chests!"
                : "[POK-QoL] No matching items to quick-stack.");
        }

        // =========================================================================
        // 3. CRAFT & BUILD FROM NEARBY CHESTS (Zero-Lag + Strict Station Checks)
        // =========================================================================

        private static bool HasAllResourcesWithCache(Component player, IEnumerable reqs, int qualityLevel)
        {
            var playerInv = _playerGetInvMethod?.Invoke(player, null);
            if (playerInv == null) return false;

            RefreshNearbyItemCacheIfNeeded(player.transform.position);
            if (_nearbyItemCounts.Count == 0) return false;

            var countMethod = playerInv.GetType().GetMethod("CountItems", new[] { typeof(string), typeof(int), typeof(bool) })
                           ?? playerInv.GetType().GetMethod("CountItems", new[] { typeof(string), typeof(int) });
            if (countMethod == null) return false;
            int pLen = countMethod.GetParameters().Length;

            foreach (var req in reqs)
            {
                var resItem = req.GetType().GetField("m_resItem")?.GetValue(req);
                if (resItem == null) continue;
                var itemData = resItem.GetType().GetField("m_itemData")?.GetValue(resItem);
                string sharedName = GetItemSharedName(itemData);
                if (string.IsNullOrEmpty(sharedName)) continue;

                var getAmt = req.GetType().GetMethod("GetAmount", new[] { typeof(int) });
                int needed = getAmt != null ? (int)getAmt.Invoke(req, new object[] { qualityLevel }) : 0;
                if (needed <= 0) continue;

                var args = pLen == 3 ? new object[] { sharedName, -1, true } : new object[] { sharedName, -1 };
                int inPlayer = (int)countMethod.Invoke(playerInv, args);
                int inChests = _nearbyItemCounts.TryGetValue(sharedName, out int c) ? c : 0;

                if (inPlayer + inChests < needed) return false;
            }

            return true;
        }

        private static void Player_HaveRequirements_Piece_Postfix(
            object __instance,
            object piece,
            object mode,
            ref bool __result
        )
        {
            if (__result || !EnableCraftFromChests.Value || piece == null) return;
            try
            {
                // ONLY apply when mode == CanBuild (enum value 0), NEVER override IsKnown/CanAlmostBuild
                if (mode != null && Convert.ToInt32(mode) != 0) return;

                var player = __instance as Component;
                if (player == null) return;

                // STRICT CRAFTING STATION CHECK (Workbench, Forge, Stonecutter, Artisan Table, etc.)
                var station = piece.GetType().GetField("m_craftingStation")?.GetValue(piece);
                if (station != null)
                {
                    var stationName = station.GetType().GetField("m_name")?.GetValue(station)?.ToString();
                    var csType = AccessTools.TypeByName("CraftingStation");
                    var haveStation = csType?.GetMethod("HaveBuildStationInRange", new[] { typeof(string), typeof(Vector3) });
                    if (haveStation != null && !string.IsNullOrEmpty(stationName))
                    {
                        var inRange = haveStation.Invoke(null, new object[] { stationName, player.transform.position });
                        if (!(inRange is bool ok) || !ok) return;
                    }
                    else
                    {
                        return;
                    }
                }

                var reqs = piece.GetType().GetField("m_resources")?.GetValue(piece) as IEnumerable;
                if (reqs == null) return;

                if (HasAllResourcesWithCache(player, reqs, 1))
                {
                    __result = true;
                }
            }
            catch { }
        }

        private static void Player_HaveRequirementItems_Postfix(
            object __instance,
            object recipe,
            bool discover,
            int qualityLevel,
            ref bool __result
        )
        {
            if (__result || discover || !EnableCraftFromChests.Value || recipe == null) return;
            try
            {
                var player = __instance as Component;
                if (player == null) return;

                var reqs = recipe.GetType().GetField("m_resources")?.GetValue(recipe) as IEnumerable;
                if (reqs == null) return;

                if (HasAllResourcesWithCache(player, reqs, qualityLevel))
                {
                    __result = true;
                }
            }
            catch { }
        }

        private static void Player_ConsumeResources_Prefix(object __instance, IEnumerable requirements, int qualityLevel)
        {
            if (!EnableCraftFromChests.Value || requirements == null) return;
            try
            {
                var player = __instance as Component;
                if (player == null) return;
                var playerInv = _playerGetInvMethod?.Invoke(player, null);
                if (playerInv == null) return;

                var countMethod = playerInv.GetType().GetMethod("CountItems", new[] { typeof(string), typeof(int), typeof(bool) })
                               ?? playerInv.GetType().GetMethod("CountItems", new[] { typeof(string), typeof(int) });
                var removeMethod = playerInv.GetType().GetMethod("RemoveItem", new[] { typeof(string), typeof(int), typeof(int), typeof(bool) })
                                ?? playerInv.GetType().GetMethod("RemoveItem", new[] { typeof(string), typeof(int), typeof(int) });
                var addPrefab = playerInv.GetType().GetMethod("AddItem", new[] { typeof(GameObject), typeof(int) });
                if (countMethod == null || removeMethod == null || addPrefab == null) return;

                int CountIn(object inv, string name)
                {
                    var pLen = countMethod.GetParameters().Length;
                    var args = pLen == 3 ? new object[] { name, -1, true } : new object[] { name, -1 };
                    return (int)countMethod.Invoke(inv, args);
                }

                void RemoveFrom(object inv, string name, int amt)
                {
                    var pLen = removeMethod.GetParameters().Length;
                    var args = pLen == 4 ? new object[] { name, amt, -1, true } : new object[] { name, amt, -1 };
                    removeMethod.Invoke(inv, args);
                }

                var chests = FindNearbyContainers(player.transform.position, CraftRadius.Value);

                foreach (var req in requirements)
                {
                    var resItem = req.GetType().GetField("m_resItem")?.GetValue(req) as Component;
                    if (resItem == null) continue;
                    var itemData = resItem.GetType().GetField("m_itemData")?.GetValue(resItem);
                    string sharedName = GetItemSharedName(itemData);
                    if (string.IsNullOrEmpty(sharedName)) continue;

                    var getAmt = req.GetType().GetMethod("GetAmount", new[] { typeof(int) });
                    int needed = getAmt != null ? (int)getAmt.Invoke(req, new object[] { qualityLevel }) : 0;
                    if (needed <= 0) continue;

                    int inPlayer = CountIn(playerInv, sharedName);
                    int missing = needed - inPlayer;
                    if (missing <= 0) continue;

                    foreach (var chest in chests)
                    {
                        if (missing <= 0) break;
                        var cInv = GetContainerInventory(chest);
                        if (cInv == null) continue;
                        int avail = CountIn(cInv, sharedName);
                        if (avail <= 0) continue;

                        int take = Math.Min(avail, missing);
                        RemoveFrom(cInv, sharedName, take);
                        addPrefab.Invoke(playerInv, new object[] { resItem.gameObject, take });
                        SaveContainer(chest);
                        missing -= take;
                    }
                }
                _cacheExpiresAt = -1f;
            }
            catch (Exception ex)
            {
                _instance?.Logger.LogWarning($"[POK-QoL] ConsumeResources warning: {ex.Message}");
            }
        }
    }
}
