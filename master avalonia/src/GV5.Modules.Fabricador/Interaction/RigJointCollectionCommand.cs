using System.Collections.Immutable;
using GV5.Core.Models;
using GV5.Geometry;

namespace GV5.Modules.Fabricador.Interaction;

/// <summary>Undoable replacement of a validated model rig snapshot.</summary>
public sealed record RigJointCollectionCommand(
    ImmutableArray<RigJoint> Before,
    ImmutableArray<RigJoint> After) : IModelDraftCommand
{
    public ModelDraftContent Apply(ModelDraftContent content) => Replace(content, After);
    public ModelDraftContent Revert(ModelDraftContent content) => Replace(content, Before);

    private static ModelDraftContent Replace(ModelDraftContent content, ImmutableArray<RigJoint> joints) =>
        ModelDraftContent.Restore(content.SchemaVersion, content.ModelId, content.Revision,
            content.Slot, content.SourceAssetId, content.SourceWidth, content.SourceHeight,
            content.Parts, content.LayerOrder, joints);
}
