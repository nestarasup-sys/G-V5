using GV5.Core.Identity;

namespace GV5.Core.Models;

/// <summary>Lightweight slot listing used to paint the Fabricator selector without loading image assets.</summary>
public sealed record ModelSlotEntry(ModelSlot Slot, ModelId ModelId, string Name);
