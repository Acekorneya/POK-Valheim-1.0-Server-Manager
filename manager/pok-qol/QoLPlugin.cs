using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text.RegularExpressions;
using BepInEx;
using BepInEx.Configuration;
using HarmonyLib;
using UnityEngine;

namespace POKValheimQoL
{
    [BepInPlugin("com.pok.valheim.qol", "POK-Valheim QoL (Drop-Off Chest & Craft From Chests)", "1.3.4")]
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
        public static ConfigEntry<bool> DropOffUseEmptySlots;
        public static ConfigEntry<bool> DropOffAutoOrganizeChests;
        public static ConfigEntry<bool> EnableQuickStackHotkey;
        public static ConfigEntry<KeyCode> QuickStackKey;
        public static ConfigEntry<bool> EnableCraftFromChests;
        public static ConfigEntry<float> CraftRadius;

        private Harmony _harmony;
        private static QoLPlugin _instance;
        private static GameObject _dropOffPrefab;

        // Fast tracked registries (zero FindObjectsOfType calls!)
        private static readonly HashSet<Component> _trackedContainers = new HashSet<Component>();
        private static readonly HashSet<Component> _trackedSigns = new HashSet<Component>();

        // ALL reflection cached ONCE at startup (zero per-frame reflection allocations!)
        private static Type _playerType;
        private static Type _containerType;
        private static Type _signType;
        private static Type _pieceType;
        private static Type _recipeType;
        private static Type _reqType;
        private static Type _itemDropType;
        private static Type _itemDataType;
        private static Type _sharedDataType;
        private static Type _inventoryType;
        private static Type _craftingStationType;

        private static FieldInfo _localPlayerField;
        private static MethodInfo _playerGetInvMethod;
        private static MethodInfo _playerGetCurrentStationMethod;

        private static FieldInfo _containerNviewField;
        private static MethodInfo _nviewIsValidMethod;
        private static MethodInfo _containerGetInvMethod;
        private static MethodInfo _containerIsInUseMethod;
        private static MethodInfo _containerSaveMethod;
        private static MethodInfo _signGetTextMethod;

        private static FieldInfo _pieceResourcesField;
        private static FieldInfo _pieceStationField;
        private static FieldInfo _recipeResourcesField;
        private static FieldInfo _recipeOnlyOneField;
        private static FieldInfo _reqResItemField;
        private static FieldInfo _reqUpgraderResourceField;
        private static MethodInfo _reqGetAmountMethod;
        private static FieldInfo _itemDropDataField;
        private static FieldInfo _itemDataSharedField;
        private static FieldInfo _itemDataStackField;
        private static FieldInfo _itemDataEquippedField;
        private static FieldInfo _itemDataGridPosField;
        private static FieldInfo _gridPosXField;
        private static FieldInfo _gridPosYField;
        private static FieldInfo _sharedNameField;
        private static FieldInfo _sharedItemTypeField;
        private static FieldInfo _sharedFoodField;
        private static FieldInfo _sharedTeleportableField;

        private static MethodInfo _invGetAllItemsMethod;
        private static MethodInfo _invGetWidthMethod;
        private static MethodInfo _invGetHeightMethod;
        private static MethodInfo _invHaveEmptySlotMethod;
        private static MethodInfo _invCountItemsMethod;
        private static int _invCountItemsParamLen;
        private static MethodInfo _invRemoveItemMethod;
        private static int _invRemoveItemParamLen;
        private static MethodInfo _invAddItemPrefabMethod;
        private static MethodInfo _invAddItemDataMethod;
        private static MethodInfo _invRemoveItemDataMethod;

        private static FieldInfo _stationNameField;
        private static FieldInfo _stationRangeBuildField;
        private static FieldInfo _stationUpgraderField;
        private static FieldInfo _allStationsField;
        private static MethodInfo _haveBuildStationMethod;

        private static Type _tmpTextType;
        private static PropertyInfo _tmpTextProp;
        private static PropertyInfo _tmpColorProp;

        private static PropertyInfo _locInstanceProp;
        private static MethodInfo _locLocalizeMethod;
        private static readonly Regex _richTextRegex = new Regex("<[^>]+>", RegexOptions.Compiled);

        // 0.5s snapshot caches (combined player + nearby chest counts, nearby stations, and per-Piece result cache)
        private static float _cacheExpiresAt = -1f;
        private static Vector3 _cacheOrigin;
        private static readonly Dictionary<string, int> _combinedItemCounts = new Dictionary<string, int>();
        private static readonly HashSet<string> _stationsInRange = new HashSet<string>();
        private static readonly Dictionary<object, bool> _pieceCanBuildCache = new Dictionary<object, bool>();
        private static readonly object[] _qualityOneArgs = new object[] { 1 };

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
            DropOffUseEmptySlots = Config.Bind("1. Drop-Off Auto-Sort", "UseEmptySlotsForNewItems", true,
                "If no chest already holds an item (or matching chests are full), place it into a nearby chest with the same item category or any chest with empty slots.");
            DropOffAutoOrganizeChests = Config.Bind("1. Drop-Off Auto-Sort", "AutoOrganizeChests", true,
                "Automatically sort and organize items cleanly inside destination chests after drop-off sorting.");

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
            Logger.LogInfo("[POK-QoL] v1.3.4 Loaded! Sign-labeled & smart category Drop-Off Chest, O(1) cached Hammer UI, Valheim 1.0 Upgrader-aware Forge/Bench crafting.");
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
            _pieceType = AccessTools.TypeByName("Piece");
            _recipeType = AccessTools.TypeByName("Recipe");
            _reqType = AccessTools.TypeByName("Piece+Requirement");
            _itemDropType = AccessTools.TypeByName("ItemDrop");
            _itemDataType = AccessTools.TypeByName("ItemDrop+ItemData");
            _sharedDataType = AccessTools.TypeByName("ItemDrop+ItemData+SharedData");
            _inventoryType = AccessTools.TypeByName("Inventory");
            _craftingStationType = AccessTools.TypeByName("CraftingStation");

            _localPlayerField = _playerType?.GetField("m_localPlayer", BindingFlags.Public | BindingFlags.Static);
            _playerGetInvMethod = _playerType?.GetMethod("GetInventory");
            _playerGetCurrentStationMethod = _playerType?.GetMethod("GetCurrentCraftingStation", Type.EmptyTypes);

            _containerNviewField = _containerType?.GetField("m_nview", BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.Instance);
            var nviewType = AccessTools.TypeByName("ZNetView");
            _nviewIsValidMethod = nviewType?.GetMethod("IsValid", Type.EmptyTypes);
            _containerGetInvMethod = _containerType?.GetMethod("GetInventory");
            _containerIsInUseMethod = _containerType?.GetMethod("IsInUse");
            _containerSaveMethod = _containerType?.GetMethod("Save", BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.Instance);
            _signGetTextMethod = _signType?.GetMethod("GetText");

            _pieceResourcesField = _pieceType?.GetField("m_resources");
            _pieceStationField = _pieceType?.GetField("m_craftingStation");
            _recipeResourcesField = _recipeType?.GetField("m_resources");
            _recipeOnlyOneField = _recipeType?.GetField("m_requireOnlyOneIngredient");
            _reqResItemField = _reqType?.GetField("m_resItem");
            _reqUpgraderResourceField = _reqType?.GetField("m_upgraderResource");
            _reqGetAmountMethod = _reqType?.GetMethod("GetAmount", new[] { typeof(int) });

            _itemDropDataField = _itemDropType?.GetField("m_itemData");
            _itemDataSharedField = _itemDataType?.GetField("m_shared");
            _itemDataStackField = _itemDataType?.GetField("m_stack");
            _itemDataEquippedField = _itemDataType?.GetField("m_equipped");
            _itemDataGridPosField = _itemDataType?.GetField("m_gridPos");
            _gridPosXField = _itemDataGridPosField?.FieldType?.GetField("x");
            _gridPosYField = _itemDataGridPosField?.FieldType?.GetField("y");
            _sharedNameField = _sharedDataType?.GetField("m_name");
            _sharedItemTypeField = _sharedDataType?.GetField("m_itemType");
            _sharedFoodField = _sharedDataType?.GetField("m_food");
            _sharedTeleportableField = _sharedDataType?.GetField("m_teleportable");

            _invGetAllItemsMethod = _inventoryType?.GetMethod("GetAllItems", Type.EmptyTypes);
            _invGetWidthMethod = _inventoryType?.GetMethod("GetWidth", Type.EmptyTypes);
            _invGetHeightMethod = _inventoryType?.GetMethod("GetHeight", Type.EmptyTypes);
            _invHaveEmptySlotMethod = _inventoryType?.GetMethod("HaveEmptySlot", Type.EmptyTypes);
            _invCountItemsMethod = _inventoryType?.GetMethod("CountItems", new[] { typeof(string), typeof(int), typeof(bool) })
                                ?? _inventoryType?.GetMethod("CountItems", new[] { typeof(string), typeof(int) });
            _invCountItemsParamLen = _invCountItemsMethod?.GetParameters().Length ?? 0;

            _invRemoveItemMethod = _inventoryType?.GetMethod("RemoveItem", new[] { typeof(string), typeof(int), typeof(int), typeof(bool) })
                                ?? _inventoryType?.GetMethod("RemoveItem", new[] { typeof(string), typeof(int), typeof(int) });
            _invRemoveItemParamLen = _invRemoveItemMethod?.GetParameters().Length ?? 0;

            _invAddItemPrefabMethod = _inventoryType?.GetMethod("AddItem", new[] { typeof(GameObject), typeof(int) });
            if (_itemDataType != null)
            {
                _invAddItemDataMethod = _inventoryType?.GetMethod("AddItem", new[] { _itemDataType });
                _invRemoveItemDataMethod = _inventoryType?.GetMethod("RemoveItem", new[] { _itemDataType });
            }

            _stationNameField = _craftingStationType?.GetField("m_name");
            _stationRangeBuildField = _craftingStationType?.GetField("m_rangeBuild");
            _stationUpgraderField = _craftingStationType?.GetField("m_upgrader");
            _allStationsField = _craftingStationType?.GetField("m_allStations", BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.Static);
            _haveBuildStationMethod = _craftingStationType?.GetMethod("HaveBuildStationInRange", BindingFlags.Public | BindingFlags.Static);

            _tmpTextType = AccessTools.TypeByName("TMPro.TMP_Text");
            _tmpTextProp = _tmpTextType?.GetProperty("text", BindingFlags.Public | BindingFlags.Instance);
            _tmpColorProp = _tmpTextType?.GetProperty("color", BindingFlags.Public | BindingFlags.Instance);

            var locType = AccessTools.TypeByName("Localization");
            _locInstanceProp = locType?.GetProperty("instance", BindingFlags.Public | BindingFlags.Static);
            _locLocalizeMethod = locType?.GetMethod("Localize", new[] { typeof(string) });
        }

        private void Update()
        {
            if (!EnableQuickStackHotkey.Value) return;
            if ((Input.GetKey(KeyCode.LeftAlt) || Input.GetKey(KeyCode.RightAlt)) && Input.GetKeyDown(QuickStackKey.Value))
            {
                try { QuickStackPlayerInventory(); }
                catch (Exception ex) { Logger.LogWarning($"[POK-QoL] Quick-Stack warning: {ex.Message}"); }
            }
        }

        private void SafePatch(string label, MethodBase target, HarmonyMethod prefix = null, HarmonyMethod postfix = null)
        {
            if (target == null)
            {
                Logger.LogWarning($"[POK-QoL] Target method not found for {label}; skipping.");
                return;
            }
            try { _harmony.Patch(target, prefix: prefix, postfix: postfix); }
            catch (Exception ex) { Logger.LogWarning($"[POK-QoL] Failed to patch {label}: {ex.Message}"); }
        }

        private void ApplyPatches()
        {
            SafePatch("ZNetScene:Awake", AccessTools.Method("ZNetScene:Awake"),
                postfix: new HarmonyMethod(typeof(QoLPlugin), nameof(ZNetScene_Awake_Postfix)));

            SafePatch("Container:Awake", AccessTools.Method("Container:Awake"),
                postfix: new HarmonyMethod(typeof(QoLPlugin), nameof(Container_Awake_Postfix)));

            SafePatch("Container:OnDestroyed", AccessTools.Method("Container:OnDestroyed"),
                postfix: new HarmonyMethod(typeof(QoLPlugin), nameof(Container_Destroy_Postfix)));

            SafePatch("Sign:Awake", AccessTools.Method("Sign:Awake"),
                postfix: new HarmonyMethod(typeof(QoLPlugin), nameof(Sign_Awake_Postfix)));

            SafePatch("Container:SetInUse", AccessTools.Method("Container:SetInUse"),
                postfix: new HarmonyMethod(typeof(QoLPlugin), nameof(Container_SetInUse_Postfix)));

            SafePatch("Player:HaveRequirementItems", AccessTools.Method("Player:HaveRequirementItems"),
                postfix: new HarmonyMethod(typeof(QoLPlugin), nameof(Player_HaveRequirementItems_Postfix)));

            var reqModeType = AccessTools.TypeByName("Player+RequirementMode");
            if (_pieceType != null && reqModeType != null)
            {
                SafePatch("Player:HaveRequirements(Piece)",
                    AccessTools.Method("Player:HaveRequirements", new[] { _pieceType, reqModeType }),
                    postfix: new HarmonyMethod(typeof(QoLPlugin), nameof(Player_HaveRequirements_Piece_Postfix)));
            }

            SafePatch("Player:ConsumeResources", AccessTools.Method("Player:ConsumeResources"),
                prefix: new HarmonyMethod(typeof(QoLPlugin), nameof(Player_ConsumeResources_Prefix)));

            SafePatch("InventoryGui:SetupRequirement", AccessTools.Method("InventoryGui:SetupRequirement"),
                postfix: new HarmonyMethod(typeof(QoLPlugin), nameof(InventoryGui_SetupRequirement_Postfix)));
        }

        private static void Container_Awake_Postfix(object __instance)
        {
            if (__instance is Component c) { _trackedContainers.Add(c); _cacheExpiresAt = -1f; }
        }

        private static void Container_Destroy_Postfix(object __instance)
        {
            if (__instance is Component c) { _trackedContainers.Remove(c); _cacheExpiresAt = -1f; }
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
                                mats[i].color = Color.Lerp(mats[i].color, new Color(0.95f, 0.58f, 0.25f, 1f), 0.38f);
                        }
                        renderer.materials = mats;
                    }

                    if (_containerType != null)
                    {
                        var contComp = _dropOffPrefab.GetComponent(_containerType);
                        contComp?.GetType().GetField("m_name")?.SetValue(contComp, "POK Drop-Off Chest");
                    }

                    if (_pieceType != null && _reqType != null && _itemDropType != null)
                    {
                        var pieceComp = _dropOffPrefab.GetComponent(_pieceType);
                        if (pieceComp != null)
                        {
                            _pieceType.GetField("m_name")?.SetValue(pieceComp, "POK Drop-Off Chest");
                            _pieceType.GetField("m_description")?.SetValue(
                                pieceComp,
                                $"Dump loot inside and close to auto-sort into nearby matching chests ({DropOffRadius.Value:0}m)."
                            );

                            var reqList = new List<object>();
                            void AddReq(string prefabName, int amount)
                            {
                                if (amount <= 0) return;
                                var itemGo = getPrefab.Invoke(__instance, new object[] { prefabName }) as GameObject;
                                var itemDrop = itemGo?.GetComponent(_itemDropType);
                                if (itemDrop == null) return;
                                var req = Activator.CreateInstance(_reqType);
                                _reqType.GetField("m_resItem")?.SetValue(req, itemDrop);
                                _reqType.GetField("m_amount")?.SetValue(req, amount);
                                _reqType.GetField("m_recover")?.SetValue(req, true);
                                reqList.Add(req);
                            }

                            AddReq("FineWood", DropOffWoodCost.Value);
                            AddReq("Copper", DropOffCopperCost.Value);

                            if (reqList.Count > 0)
                            {
                                var arr = Array.CreateInstance(_reqType, reqList.Count);
                                for (int i = 0; i < reqList.Count; i++) arr.SetValue(reqList[i], i);
                                _pieceResourcesField?.SetValue(pieceComp, arr);
                            }
                        }
                    }
                }

                int hash = GetStableHashCode(DROPOFF_PREFAB_NAME);
                if (!prefabsList.Contains(_dropOffPrefab)) prefabsList.Add(_dropOffPrefab);
                namedPrefabs[hash] = _dropOffPrefab;

                var hammerGo = getPrefab.Invoke(__instance, new object[] { "Hammer" }) as GameObject;
                if (hammerGo != null && _itemDropType != null)
                {
                    var hammerDrop = hammerGo.GetComponent(_itemDropType);
                    var itemData = _itemDropDataField?.GetValue(hammerDrop);
                    var shared = _itemDataSharedField?.GetValue(itemData);
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
        // ZERO-ALLOCATION CACHED HELPERS
        // =========================================================================

        private static Component GetLocalPlayer() => _localPlayerField?.GetValue(null) as Component;

        private static void ShowHudMessage(string text)
        {
            try
            {
                var hudType = AccessTools.TypeByName("MessageHud");
                var hud = hudType?.GetProperty("instance", BindingFlags.Public | BindingFlags.Static)?.GetValue(null);
                hudType?.GetMethod("ShowMessage")?.Invoke(hud, new object[] { 1, text, 0, null });
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
                if (_nviewIsValidMethod != null && _nviewIsValidMethod.Invoke(nview, null) is bool b && !b) continue;
                if (_containerIsInUseMethod?.Invoke(comp, null) is bool u && u) continue;

                result.Add(comp);
            }

            if (dead != null)
                foreach (var d in dead) _trackedContainers.Remove(d);
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
                foreach (var d in dead) _trackedSigns.Remove(d);
            return false;
        }

        private static object GetContainerInventory(Component container) => _containerGetInvMethod?.Invoke(container, null);

        private static string GetItemSharedName(object item)
        {
            var shared = _itemDataSharedField?.GetValue(item);
            return _sharedNameField?.GetValue(shared) as string ?? "";
        }

        private static int GetItemStack(object item)
        {
            var val = _itemDataStackField?.GetValue(item);
            return val is int i ? i : 0;
        }

        private static bool InventoryHasItemNamed(object inventory, string sharedName)
        {
            var items = _invGetAllItemsMethod?.Invoke(inventory, null) as IEnumerable;
            if (items == null) return false;
            foreach (var item in items)
                if (GetItemSharedName(item) == sharedName) return true;
            return false;
        }

        private static void SaveContainer(Component container)
        {
            try { _containerSaveMethod?.Invoke(container, null); } catch { }
        }

        private static void AddInventoryItemsToCounts(object inv)
        {
            var items = _invGetAllItemsMethod?.Invoke(inv, null) as IEnumerable;
            if (items == null) return;
            foreach (var item in items)
            {
                string name = GetItemSharedName(item);
                if (string.IsNullOrEmpty(name)) continue;
                int stack = GetItemStack(item);
                if (stack <= 0) continue;
                _combinedItemCounts[name] = _combinedItemCounts.TryGetValue(name, out int cur) ? cur + stack : stack;
            }
        }

        private static void RefreshSnapshotIfNeeded(Component player)
        {
            float now = Time.unscaledTime;
            var origin = player.transform.position;
            if (now < _cacheExpiresAt && (_cacheOrigin - origin).sqrMagnitude < 1.0f)
                return;

            _cacheExpiresAt = now + 0.5f;
            _cacheOrigin = origin;
            _combinedItemCounts.Clear();
            _stationsInRange.Clear();
            _pieceCanBuildCache.Clear();

            // 1. Snapshot player inventory + nearby chests
            var playerInv = _playerGetInvMethod?.Invoke(player, null);
            if (playerInv != null) AddInventoryItemsToCounts(playerInv);
            foreach (var chest in FindNearbyContainers(origin, CraftRadius.Value))
            {
                var inv = GetContainerInventory(chest);
                if (inv != null) AddInventoryItemsToCounts(inv);
            }

            // 2. Snapshot all crafting stations currently in build range (Workbench, Forge, Stonecutter, etc.)
            var allStations = _allStationsField?.GetValue(null) as IEnumerable;
            if (allStations != null)
            {
                foreach (var stObj in allStations)
                {
                    var stComp = stObj as Component;
                    if (stComp == null || !stComp.gameObject) continue;
                    var name = _stationNameField?.GetValue(stComp) as string;
                    if (string.IsNullOrEmpty(name)) continue;
                    var rangeObj = _stationRangeBuildField?.GetValue(stComp);
                    float range = rangeObj is float f ? f : 20f;
                    if ((stComp.transform.position - origin).sqrMagnitude <= range * range)
                    {
                        _stationsInRange.Add(name);
                    }
                }
            }
        }

        private static bool IsStationInRange(Component player, string stationName)
        {
            if (string.IsNullOrEmpty(stationName)) return true;
            if (_stationsInRange.Contains(stationName)) return true;

            // Fallback to Valheim's static HaveBuildStationInRange if m_allStations wasn't populated
            if (_haveBuildStationMethod != null)
            {
                try
                {
                    var p = _haveBuildStationMethod.GetParameters();
                    if (p.Length == 2)
                    {
                        var res = _haveBuildStationMethod.Invoke(null, new object[] { stationName, player.transform.position });
                        if (res is bool b ? b : res != null) { _stationsInRange.Add(stationName); return true; }
                    }
                }
                catch { }
            }
            return false;
        }

        private static int GetItemTypeInt(object item)
        {
            var shared = _itemDataSharedField?.GetValue(item);
            var t = _sharedItemTypeField?.GetValue(shared);
            return t != null ? Convert.ToInt32(t) : 0;
        }

        private static bool ContainsAny(string text, params string[] keywords)
        {
            for (int i = 0; i < keywords.Length; i++)
                if (text.IndexOf(keywords[i], StringComparison.OrdinalIgnoreCase) >= 0)
                    return true;
            return false;
        }

        // Smart logical storage categories so rocks/ores NEVER mix into food chests!
        private static string GetSmartCategory(object item)
        {
            var shared = _itemDataSharedField?.GetValue(item);
            string name = (_sharedNameField?.GetValue(shared) as string ?? "").ToLowerInvariant();
            int itemType = GetItemTypeInt(item);
            float food = _sharedFoodField?.GetValue(shared) is float f ? f : 0f;
            bool teleportable = !(_sharedTeleportableField?.GetValue(shared) is bool tp) || tp;

            // Valheim ItemType enum values:
            // 1=Material, 2=Consumable, 3=OneHandedWeapon, 4=Bow, 5=Shield, 6=Helmet, 7=Chest,
            // 9=Ammo, 11=Legs, 12=Hands, 13=Trophy, 14=TwoHandedWeapon, 15=Torch, 16=Misc,
            // 17=Shoulder, 18=Utility, 19=Tool, 20=Attach_Atgeir, 21=Fish, 22=TwoHandedWeaponLeft, 23=AmmoNonEquipable
            if (itemType == 2 || itemType == 21 || food > 0f)
                return "Food";
            if (itemType == 13)
                return "Trophy";
            if (itemType == 9 || itemType == 23)
                return "Ammo";
            if (itemType == 6 || itemType == 7 || itemType == 11 || itemType == 12 || itemType == 17 || itemType == 18)
                return "Armor";
            if (itemType == 3 || itemType == 4 || itemType == 5 || itemType == 14 || itemType == 15 || itemType == 19 || itemType == 20 || itemType == 22)
                return "WeaponsAndTools";

            // Sub-classify Material (1) and Misc (16) so Food, Ores, Building mats, Hides, and Valuables stay cleanly separated
            if (ContainsAny(name, "meat", "fish", "berry", "berries", "mushroom", "carrot", "turnip", "onion",
                "barley", "flax", "flour", "honey", "thistle", "dandelion", "egg", "jelly", "entrails", "bloodbag",
                "bloodclot", "sausage", "stew", "soup", "pie", "bread", "jam", "jerky", "mead", "wine", "seed",
                "acorn", "beech", "birch", "fircone", "pinecone", "jotunpuffs", "magecap", "fiddlehead", "vine",
                "necktail", "sap", "spice", "yeast", "milk"))
                return "Food";

            if (ContainsAny(name, "leather", "hide", "pelt", "scale", "bone", "feather", "fang", "claw", "troll",
                "root", "guck", "ooze", "needle", "chitin", "carapace", "mandible", "bilebag", "tissue",
                "linen", "thread", "jute", "wool", "hair", "fur", "horn", "eye", "gland", "bladder"))
                return "HidesAndDrops";

            if (!teleportable || ContainsAny(name, "ore", "ironscrap", "scrapiron", "copper", "tin", "bronze", "iron",
                "silver", "blackmetal", "flametal", "ingot", "coal", "charcoal", "eitr", "blackcore", "surtlingcore",
                "moltencore", "chain", "nails"))
                return "OreAndMetal";

            if (ContainsAny(name, "wood", "stone", "flint", "obsidian", "marble", "grausten", "tar", "crystal",
                "resin", "ashwood", "yggdrasil"))
                return "StoneAndWood";

            if (ContainsAny(name, "coins", "amber", "ruby", "pearl", "gem", "necklace", "gold"))
                return "Valuables";

            return "OtherMaterial";
        }

        private static int GetInventoryItemCount(object inventory)
        {
            var items = _invGetAllItemsMethod?.Invoke(inventory, null) as IEnumerable;
            if (items == null) return 0;
            int count = 0;
            foreach (var _ in items) count++;
            return count;
        }

        // Returns true ONLY if the chest has items and ALL items in it match the target smart category
        private static bool InventoryMatchesCategoryStrictly(object inventory, string category)
        {
            var items = _invGetAllItemsMethod?.Invoke(inventory, null) as IEnumerable;
            if (items == null) return false;
            bool hasAny = false;
            foreach (var item in items)
            {
                hasAny = true;
                if (GetSmartCategory(item) != category)
                    return false;
            }
            return hasAny;
        }

        private static string GetLocalizedItemName(object item)
        {
            string raw = GetItemSharedName(item);
            if (string.IsNullOrEmpty(raw)) return "";
            try
            {
                var loc = _locInstanceProp?.GetValue(null);
                if (loc != null && _locLocalizeMethod != null)
                {
                    var localized = _locLocalizeMethod.Invoke(loc, new object[] { raw }) as string;
                    if (!string.IsNullOrEmpty(localized)) return localized.Trim();
                }
            }
            catch { }
            return raw.Replace("$item_", "").Replace("_", " ").Trim();
        }

        // Maps each non-[DROPOFF] Sign to its SINGLE closest chest within 1.65m so adjacent chests never steal each other's signs
        private static Dictionary<Component, string> BuildChestSignLabels(List<Component> targets)
        {
            var labels = new Dictionary<Component, string>();
            var bestDistByChest = new Dictionary<Component, float>();
            const float maxDistSq = 1.65f * 1.65f;
            var dropTag = (DropOffTag.Value ?? "[DROPOFF]").Trim();
            List<Component> dead = null;

            foreach (var signComp in _trackedSigns)
            {
                if (signComp == null || !signComp.gameObject)
                {
                    if (dead == null) dead = new List<Component>();
                    dead.Add(signComp);
                    continue;
                }

                var raw = _signGetTextMethod?.Invoke(signComp, null)?.ToString() ?? "";
                var clean = _richTextRegex.Replace(raw, "").Trim();
                if (string.IsNullOrEmpty(clean)) continue;
                if (!string.IsNullOrEmpty(dropTag) && clean.IndexOf(dropTag, StringComparison.OrdinalIgnoreCase) >= 0)
                    continue;

                Component closestChest = null;
                float closestDistSq = maxDistSq;
                var signPos = signComp.transform.position;

                foreach (var chest in targets)
                {
                    float dSq = (chest.transform.position - signPos).sqrMagnitude;
                    if (dSq < closestDistSq)
                    {
                        closestDistSq = dSq;
                        closestChest = chest;
                    }
                }

                if (closestChest != null && (!bestDistByChest.TryGetValue(closestChest, out float prev) || closestDistSq < prev))
                {
                    bestDistByChest[closestChest] = closestDistSq;
                    labels[closestChest] = clean;
                }
            }

            if (dead != null)
                foreach (var d in dead) _trackedSigns.Remove(d);
            return labels;
        }

        private static string NormalizeWord(string s)
        {
            s = (s ?? "").Trim().ToLowerInvariant();
            if (s.EndsWith("ies") && s.Length > 4) return s.Substring(0, s.Length - 3) + "y";
            if (s.EndsWith("es") && s.Length > 4 && !s.EndsWith("ores") && !s.EndsWith("stones") && !s.EndsWith("hides"))
                return s.Substring(0, s.Length - 2);
            if (s.EndsWith("s") && s.Length > 3) return s.Substring(0, s.Length - 1);
            return s;
        }

        // Checks whether an item matches a chest's Sign label (supports item names like "Wood", "Rocks", "Copper"
        // AND category labels like "Food", "Ores", "Hides", "Trophies", "Valuables", plus multi-labels like "Wood / Stone")
        private static bool ItemMatchesSignLabel(object item, string signLabel, string itemCategory)
        {
            if (string.IsNullOrEmpty(signLabel)) return false;

            string displayName = GetLocalizedItemName(item).ToLowerInvariant();
            string rawName = GetItemSharedName(item).Replace("$item_", "").Replace("_", " ").ToLowerInvariant();
            var tokens = signLabel.Split(new[] { ',', '/', '|', '&', '\n', '\r', ';' }, StringSplitOptions.RemoveEmptyEntries);

            foreach (var rawTok in tokens)
            {
                string tok = rawTok.Trim().ToLowerInvariant();
                if (tok.Length < 2) continue;
                string normTok = NormalizeWord(tok);

                // 1. Direct item display name / prefab name match (e.g. "Wood", "Fine Wood", "Copper", "Stone", "Leather")
                if (displayName == tok || rawName == tok || NormalizeWord(displayName) == normTok)
                    return true;
                if (displayName.Contains(normTok) || rawName.Contains(normTok))
                    return true;

                // 2. Common player synonyms for specific items
                if ((normTok == "rock" || normTok == "cobble") && (displayName.Contains("stone") || rawName.Contains("stone") || rawName.Contains("marble") || rawName.Contains("grausten")))
                    return true;
                if ((normTok == "log" || normTok == "lumber") && (displayName.Contains("wood") || rawName.Contains("wood")))
                    return true;

                // 3. Category sign labels (e.g. "Food", "Ores", "Metals", "Hides", "Drops", "Trophies", "Valuables", "Ammo", "Armor", "Weapons")
                switch (normTok)
                {
                    case "food":
                    case "cook":
                    case "cooking":
                    case "kitchen":
                    case "meal":
                    case "farm":
                    case "farming":
                    case "crop":
                    case "seed":
                    case "potion":
                    case "mead":
                    case "drink":
                    case "eat":
                        if (itemCategory == "Food") return true;
                        break;

                    case "ore":
                    case "metal":
                    case "ingot":
                    case "bar":
                    case "forge":
                    case "smelt":
                    case "smelting":
                    case "mineral":
                        if (itemCategory == "OreAndMetal") return true;
                        break;

                    case "build":
                    case "building":
                    case "mat":
                    case "material":
                        if (itemCategory == "StoneAndWood") return true;
                        break;

                    case "hide":
                    case "pelt":
                    case "leather":
                    case "mob":
                    case "drop":
                    case "monster":
                    case "loot":
                    case "creature":
                        if (itemCategory == "HidesAndDrops") return true;
                        break;

                    case "gold":
                    case "coin":
                    case "treasure":
                    case "valuable":
                    case "gem":
                    case "money":
                    case "bank":
                        if (itemCategory == "Valuables") return true;
                        break;

                    case "trophy":
                    case "head":
                        if (itemCategory == "Trophy") return true;
                        break;

                    case "ammo":
                    case "arrow":
                    case "bolt":
                        if (itemCategory == "Ammo") return true;
                        break;

                    case "armor":
                    case "armour":
                    case "gear":
                    case "clothe":
                        if (itemCategory == "Armor") return true;
                        break;

                    case "weapon":
                    case "tool":
                    case "combat":
                        if (itemCategory == "WeaponsAndTools") return true;
                        break;
                }
            }
            return false;
        }

        private static bool InventoryHasEmptySlot(object inventory)
        {
            if (_invHaveEmptySlotMethod != null)
            {
                var res = _invHaveEmptySlotMethod.Invoke(inventory, null);
                if (res is bool b) return b;
            }
            return true;
        }

        private static void OrganizeInventoryGrid(object inventory)
        {
            if (!DropOffAutoOrganizeChests.Value || inventory == null) return;
            if (_invGetAllItemsMethod == null || _invGetWidthMethod == null || _itemDataGridPosField == null || _gridPosXField == null || _gridPosYField == null)
                return;
            try
            {
                var itemsEnum = _invGetAllItemsMethod.Invoke(inventory, null) as IEnumerable;
                if (itemsEnum == null) return;
                var items = new List<object>();
                foreach (var it in itemsEnum) items.Add(it);
                if (items.Count <= 1) return;

                int width = (int)_invGetWidthMethod.Invoke(inventory, null);
                int height = _invGetHeightMethod != null ? (int)_invGetHeightMethod.Invoke(inventory, null) : 4;
                if (width <= 0 || items.Count > width * height) return;

                // Sort cleanly by ItemType -> SharedName -> largest stack first
                items.Sort((a, b) =>
                {
                    int tc = GetItemTypeInt(a).CompareTo(GetItemTypeInt(b));
                    if (tc != 0) return tc;
                    int nc = string.CompareOrdinal(GetItemSharedName(a), GetItemSharedName(b));
                    if (nc != 0) return nc;
                    return GetItemStack(b).CompareTo(GetItemStack(a));
                });

                var gridPosType = _itemDataGridPosField.FieldType;
                for (int i = 0; i < items.Count; i++)
                {
                    object gp = Activator.CreateInstance(gridPosType);
                    _gridPosXField.SetValue(gp, i % width);
                    _gridPosYField.SetValue(gp, i / width);
                    _itemDataGridPosField.SetValue(items[i], gp);
                }
            }
            catch { }
        }

        // =========================================================================
        // 1. DROP-OFF AUTO-SORT CHEST (3-Pass: Exact Match -> Same Category -> Empty Slot)
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
                var itemsEnum = _invGetAllItemsMethod?.Invoke(srcInv, null) as IEnumerable;
                if (srcInv == null || itemsEnum == null || _invAddItemDataMethod == null || _invRemoveItemDataMethod == null) return;

                var srcItems = new List<object>();
                foreach (var it in itemsEnum) srcItems.Add(it);
                if (srcItems.Count == 0) return;

                var origin = container.transform.position;
                var targets = FindNearbyContainers(origin, DropOffRadius.Value, container)
                    .Where(c => !IsDropOffContainer(c))
                    .OrderBy(c => (c.transform.position - origin).sqrMagnitude)
                    .ToList();

                // Map each nearby Sign to its single closest chest (within 1.65m)
                var chestLabels = BuildChestSignLabels(targets);

                int movedStacks = 0;
                var modifiedChests = new HashSet<Component>();

                bool TryMoveTo(object item, Component target)
                {
                    var dstInv = GetContainerInventory(target);
                    if (dstInv == null) return false;
                    if (_invAddItemDataMethod.Invoke(dstInv, new[] { item }) is bool ok && ok)
                    {
                        _invRemoveItemDataMethod.Invoke(srcInv, new[] { item });
                        modifiedChests.Add(target);
                        movedStacks++;
                        return true;
                    }
                    return false;
                }

                foreach (var item in srcItems)
                {
                    string name = GetItemSharedName(item);
                    if (string.IsNullOrEmpty(name)) continue;
                    string category = GetSmartCategory(item);
                    bool placed = false;

                    // Pass 0 (Highest Priority): Chest with a Sign label matching this item or category
                    // (works even if the signed chest is completely empty!)
                    foreach (var target in targets)
                    {
                        if (!chestLabels.TryGetValue(target, out string label)) continue;
                        if (!ItemMatchesSignLabel(item, label, category)) continue;
                        if (TryMoveTo(item, target)) { placed = true; break; }
                    }

                    // Pass 1: Chest that ALREADY has this exact item
                    if (!placed)
                    {
                        foreach (var target in targets)
                        {
                            var dstInv = GetContainerInventory(target);
                            if (dstInv == null || !InventoryHasItemNamed(dstInv, name)) continue;
                            if (TryMoveTo(item, target)) { placed = true; break; }
                        }
                    }

                    if (!placed && DropOffUseEmptySlots.Value)
                    {
                        // Pass 2: Unlabeled chest with empty slots whose items ALL belong to the SAME smart category
                        // (Signed chests are reserved for their sign label!)
                        foreach (var target in targets)
                        {
                            if (chestLabels.ContainsKey(target)) continue;
                            var dstInv = GetContainerInventory(target);
                            if (dstInv == null || !InventoryHasEmptySlot(dstInv)) continue;
                            if (!InventoryMatchesCategoryStrictly(dstInv, category)) continue;
                            if (TryMoveTo(item, target)) { placed = true; break; }
                        }

                        // Pass 3: ONLY a COMPLETELY EMPTY, UNLABELED chest (starts a new dedicated chest for this category;
                        // NEVER dumps unrelated items into a Food chest or a Sign-labeled chest!)
                        if (!placed)
                        {
                            foreach (var target in targets)
                            {
                                if (chestLabels.ContainsKey(target)) continue;
                                var dstInv = GetContainerInventory(target);
                                if (dstInv == null || GetInventoryItemCount(dstInv) != 0) continue;
                                if (TryMoveTo(item, target)) { placed = true; break; }
                            }
                        }
                    }
                }

                int remaining = srcItems.Count - movedStacks;
                if (movedStacks > 0)
                {
                    foreach (var chest in modifiedChests)
                    {
                        OrganizeInventoryGrid(GetContainerInventory(chest));
                        SaveContainer(chest);
                    }
                    SaveContainer(container);
                    _cacheExpiresAt = -1f;
                    string keptNote = remaining > 0 ? $" ({remaining} kept in Drop-Off: no matching/empty chest)" : "";
                    ShowHudMessage($"[POK-QoL] Sorted {movedStacks} stack(s) into {modifiedChests.Count} chest(s){keptNote}");
                }
                else if (remaining > 0)
                {
                    ShowHudMessage($"[POK-QoL] Kept {remaining} stack(s) in Drop-Off (no matching category or empty chest nearby).");
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
            var itemsEnum = _invGetAllItemsMethod?.Invoke(playerInv, null) as IEnumerable;
            if (playerInv == null || itemsEnum == null || _invAddItemDataMethod == null || _invRemoveItemDataMethod == null) return;

            var items = new List<object>();
            foreach (var it in itemsEnum) items.Add(it);
            if (items.Count == 0) return;

            var targets = FindNearbyContainers(player.transform.position, DropOffRadius.Value)
                .Where(c => !IsDropOffContainer(c))
                .ToList();
            if (targets.Count == 0)
            {
                ShowHudMessage("[POK-QoL] No nearby chests found to quick-stack into.");
                return;
            }

            int moved = 0;
            foreach (var item in items)
            {
                if (_itemDataEquippedField?.GetValue(item) is bool eq && eq) continue;
                var gridPos = _itemDataGridPosField?.GetValue(item);
                if (gridPos != null && _gridPosYField?.GetValue(gridPos) is int gy && gy == 0) continue;

                string name = GetItemSharedName(item);
                if (string.IsNullOrEmpty(name)) continue;

                foreach (var target in targets)
                {
                    var dstInv = GetContainerInventory(target);
                    if (dstInv == null || !InventoryHasItemNamed(dstInv, name)) continue;

                    if (_invAddItemDataMethod.Invoke(dstInv, new[] { item }) is bool ok && ok)
                    {
                        _invRemoveItemDataMethod.Invoke(playerInv, new[] { item });
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
        // 3. CRAFT & BUILD FROM NEARBY CHESTS (Pure O(1) Cache + Strict Stations)
        // =========================================================================

        private static bool IsPlayerAtUpgraderStation(Component player)
        {
            if (player == null || _playerGetCurrentStationMethod == null || _stationUpgraderField == null)
                return false;
            var currentStation = _playerGetCurrentStationMethod.Invoke(player, null);
            if (currentStation == null) return false;
            return _stationUpgraderField.GetValue(currentStation) is bool u && u;
        }

        private static bool ShouldSkipRequirementForStation(object req, bool isUpgraderStation)
        {
            if (_reqUpgraderResourceField == null) return false;
            bool isUpgraderReq = _reqUpgraderResourceField.GetValue(req) is bool ur && ur;
            return isUpgraderReq != isUpgraderStation;
        }

        private static bool HasAllResourcesCached(
            IEnumerable reqs,
            int qualityLevel,
            int amountMultiplier = 1,
            bool isUpgraderStation = false,
            bool requireOnlyOne = false
        )
        {
            if (_combinedItemCounts.Count == 0) return false;
            int mult = Math.Max(1, amountMultiplier);

            foreach (var req in reqs)
            {
                if (ShouldSkipRequirementForStation(req, isUpgraderStation))
                    continue;

                var resItem = _reqResItemField?.GetValue(req);
                if (resItem == null) continue;
                var itemData = _itemDropDataField?.GetValue(resItem);
                string sharedName = GetItemSharedName(itemData);
                if (string.IsNullOrEmpty(sharedName)) continue;

                int needed = (_reqGetAmountMethod != null
                    ? (int)_reqGetAmountMethod.Invoke(req, qualityLevel == 1 ? _qualityOneArgs : new object[] { qualityLevel })
                    : 0) * mult;
                if (needed <= 0) continue;

                bool hasEnough = _combinedItemCounts.TryGetValue(sharedName, out int total) && total >= needed;
                if (requireOnlyOne)
                {
                    if (hasEnough) return true;
                }
                else
                {
                    if (!hasEnough) return false;
                }
            }
            return !requireOnlyOne;
        }

        private static void Player_HaveRequirements_Piece_Postfix(
            object __instance,
            object __0,
            object __1,
            ref bool __result
        )
        {
            if (__result || !EnableCraftFromChests.Value || __0 == null) return;
            try
            {
                // Only apply when mode == CanBuild (0)
                if (__1 != null && Convert.ToInt32(__1) != 0) return;

                var player = __instance as Component;
                if (player == null) return;

                RefreshSnapshotIfNeeded(player);

                // O(1) zero-allocation lookup for repeated Hammer UI calls in the same 0.5s window
                if (_pieceCanBuildCache.TryGetValue(__0, out bool cachedCanBuild))
                {
                    __result = cachedCanBuild;
                    return;
                }

                // Strict Crafting Station check (Workbench, Forge, Stonecutter, Artisan Table, etc.)
                var station = _pieceStationField?.GetValue(__0);
                if (station != null)
                {
                    var stationName = _stationNameField?.GetValue(station) as string;
                    if (!IsStationInRange(player, stationName))
                    {
                        _pieceCanBuildCache[__0] = false;
                        return;
                    }
                }

                var reqs = _pieceResourcesField?.GetValue(__0) as IEnumerable;
                bool canBuild = reqs != null && HasAllResourcesCached(reqs, 1, 1);
                _pieceCanBuildCache[__0] = canBuild;
                if (canBuild)
                {
                    __result = true;
                }
            }
            catch { }
        }

        private static void Player_HaveRequirementItems_Postfix(
            object __instance,
            object __0,
            bool __1,
            int __2,
            object[] __args,
            ref bool __result
        )
        {
            if (__result || __1 || !EnableCraftFromChests.Value || __0 == null) return;
            try
            {
                var player = __instance as Component;
                if (player == null) return;

                RefreshSnapshotIfNeeded(player);

                var reqs = _recipeResourcesField?.GetValue(__0) as IEnumerable;
                int amount = (__args != null && __args.Length > 3 && __args[3] is int a) ? a : 1;
                bool isUpgrader = IsPlayerAtUpgraderStation(player);
                bool requireOnlyOne = _recipeOnlyOneField != null && (_recipeOnlyOneField.GetValue(__0) is bool o && o);
                if (reqs != null && HasAllResourcesCached(reqs, __2, amount, isUpgrader, requireOnlyOne))
                {
                    __result = true;
                }
            }
            catch { }
        }

        private static void Player_ConsumeResources_Prefix(object __instance, object __0, int __1, object[] __args)
        {
            var requirements = __0 as IEnumerable;
            int qualityLevel = __1;
            int amount = (__args != null && __args.Length > 3 && __args[3] is int a) ? Math.Max(1, a) : 1;
            if (!EnableCraftFromChests.Value || requirements == null) return;
            try
            {
                var player = __instance as Component;
                if (player == null) return;
                var playerInv = _playerGetInvMethod?.Invoke(player, null);
                if (playerInv == null || _invCountItemsMethod == null || _invRemoveItemMethod == null || _invAddItemPrefabMethod == null) return;

                int CountIn(object inv, string name)
                {
                    var args = _invCountItemsParamLen == 3 ? new object[] { name, -1, true } : new object[] { name, -1 };
                    return (int)_invCountItemsMethod.Invoke(inv, args);
                }

                void RemoveFrom(object inv, string name, int amt)
                {
                    var args = _invRemoveItemParamLen == 4 ? new object[] { name, amt, -1, true } : new object[] { name, amt, -1 };
                    _invRemoveItemMethod.Invoke(inv, args);
                }

                var chests = FindNearbyContainers(player.transform.position, CraftRadius.Value);
                bool isUpgrader = IsPlayerAtUpgraderStation(player);

                foreach (var req in requirements)
                {
                    if (ShouldSkipRequirementForStation(req, isUpgrader)) continue;
                    var resItem = _reqResItemField?.GetValue(req) as Component;
                    if (resItem == null) continue;
                    var itemData = _itemDropDataField?.GetValue(resItem);
                    string sharedName = GetItemSharedName(itemData);
                    if (string.IsNullOrEmpty(sharedName)) continue;

                    int needed = (_reqGetAmountMethod != null ? (int)_reqGetAmountMethod.Invoke(req, new object[] { qualityLevel }) : 0) * amount;
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
                        _invAddItemPrefabMethod.Invoke(playerInv, new object[] { resItem.gameObject, take });
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

        // Updates Crafting & Upgrade UI requirement text, stops red flashing, AND sets __result = true
        // so the Upgrade / Craft button enables when nearby chests have enough materials!
        private static void InventoryGui_SetupRequirement_Postfix(
            Transform __0,
            object __1,
            object __2,
            bool __3,
            int __4,
            object[] __args,
            ref bool __result
        )
        {
            if (!EnableCraftFromChests.Value || __0 == null || __1 == null || __2 == null || _tmpTextType == null)
                return;
            try
            {
                var player = __2 as Component;
                if (player == null) return;

                var resItem = _reqResItemField?.GetValue(__1);
                if (resItem == null) return;
                var itemData = _itemDropDataField?.GetValue(resItem);
                string sharedName = GetItemSharedName(itemData);
                if (string.IsNullOrEmpty(sharedName)) return;

                int quality = __4;
                int mult = (__args != null && __args.Length > 5 && __args[5] is int m) ? Math.Max(1, m) : 1;
                int needed = (_reqGetAmountMethod != null
                    ? (int)_reqGetAmountMethod.Invoke(__1, quality == 1 ? _qualityOneArgs : new object[] { quality })
                    : 0) * mult;
                if (needed <= 0) return;

                RefreshSnapshotIfNeeded(player);
                int total = _combinedItemCounts.TryGetValue(sharedName, out int c) ? c : 0;

                var amountTf = __0.Find("res_amount");
                if (amountTf != null)
                {
                    var tmpComp = amountTf.GetComponent(_tmpTextType);
                    if (tmpComp != null)
                    {
                        _tmpTextProp?.SetValue(tmpComp, $"{needed}/{total}");
                        if (total >= needed)
                        {
                            _tmpColorProp?.SetValue(tmpComp, Color.white);
                        }
                    }
                }

                if (total >= needed)
                {
                    __result = true;
                }
            }
            catch { }
        }
    }
}
