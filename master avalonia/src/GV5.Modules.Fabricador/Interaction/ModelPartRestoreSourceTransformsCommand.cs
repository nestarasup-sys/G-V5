using System.Collections.Immutable;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;

namespace GV5.Modules.Fabricador.Interaction;

/// <summary>Restores imported transforms for model parts as one reversible edit.</summary>
public sealed record ModelPartRestoreSourceTransformsCommand(
    ImmutableArray<ModelPartTransformChange> Changes) : IModelDraftCommand
{
    public ModelDraftContent Apply(ModelDraftContent content) => Replace(content, revert: false);
    public ModelDraftContent Revert(ModelDraftContent content) => Replace(content, revert: true);

    private ModelDraftContent Replace(ModelDraftContent content, bool revert)
    {
        ArgumentNullException.ThrowIfNull(content);
        if (Changes.IsDefaultOrEmpty || Changes.Select(change => change.PartId).Distinct().Count() != Changes.Length)
            throw new ArgumentException("A source restore command requires unique part transforms.", nameof(Changes));

        var changes = Changes.ToDictionary(change => change.PartId);
        var found = new HashSet<ModelPartId>();
        var parts = content.Parts.Select(part =>
        {
            if (!changes.TryGetValue(part.Id, out var change)) return part;
            found.Add(part.Id);
            return part.WithTransform(revert ? change.Before : change.After);
        }).ToArray();
        if (found.Count != changes.Count)
            throw new InvalidOperationException("A source restore target no longer exists in this draft.");

        return ModelDraftContent.Restore(content.SchemaVersion, content.ModelId, content.Revision,
            content.Slot, content.SourceAssetId, content.SourceWidth, content.SourceHeight,
            parts, content.LayerOrder, content.RigJoints);
    }
}

public sealed record ModelPartTransformChange(ModelPartId PartId, Transform2D Before, Transform2D After);
