using System.Collections.Immutable;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;

namespace GV5.Modules.Fabricador.Interaction;

/// <summary>Replaces a model part by two side-by-side parts while retaining its ID for the left half.</summary>
public sealed record ModelPartSplitCommand(
    ModelPart Original,
    ModelPart Left,
    ModelPart Right) : IModelDraftCommand
{
    public ModelDraftContent Apply(ModelDraftContent content)
    {
        ArgumentNullException.ThrowIfNull(content);
        if (Original.Id != Left.Id || Original.Id == Right.Id || content.Parts.Any(part => part.Id == Right.Id))
            throw new ArgumentException("A split must retain the original ID on the left and add a new right-part ID.");

        var found = false;
        var parts = content.Parts.Select(part =>
        {
            if (part.Id != Original.Id) return part;
            found = true;
            return Left;
        }).ToArray();
        if (!found) throw new InvalidOperationException("The split target no longer exists in this draft.");

        var order = ImmutableArray.CreateBuilder<ModelPartId>(content.LayerOrder.Length + 1);
        foreach (var id in content.LayerOrder)
        {
            order.Add(id);
            if (id == Original.Id) order.Add(Right.Id);
        }

        return ModelDraftContent.Restore(content.SchemaVersion, content.ModelId, content.Revision,
            content.Slot, content.SourceAssetId, content.SourceWidth, content.SourceHeight,
            parts.Append(Right), order.ToImmutable(), content.RigJoints);
    }

    public ModelDraftContent Revert(ModelDraftContent content)
    {
        ArgumentNullException.ThrowIfNull(content);
        var hasOriginal = content.Parts.Any(part => part.Id == Original.Id);
        var hasRight = content.Parts.Any(part => part.Id == Right.Id);
        if (!hasOriginal || !hasRight)
            throw new InvalidOperationException("Both split parts must still exist before undoing the split.");

        var parts = content.Parts
            .Where(part => part.Id != Right.Id)
            .Select(part => part.Id == Original.Id ? Original : part)
            .ToArray();
        var order = content.LayerOrder.Where(id => id != Right.Id).ToImmutableArray();
        return ModelDraftContent.Restore(content.SchemaVersion, content.ModelId, content.Revision,
            content.Slot, content.SourceAssetId, content.SourceWidth, content.SourceHeight,
            parts, order, content.RigJoints);
    }
}
