using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;

namespace GV5.Modules.Fabricador.Interaction;

/// <summary>Adapts the geometry rig movement result to the immutable Fabricator draft.</summary>
internal static class ModelRigMovement
{
    public static ModelDraftContent Translate(ModelDraftContent content, ModelPartId rootPartId, Transform2D targetTransform)
    {
        var root = content.Parts.FirstOrDefault(part => part.Id == rootPartId)
            ?? throw new InvalidOperationException("The moved model part no longer exists in this draft.");
        if (targetTransform.Scale != root.Transform.Scale
            || targetTransform.RotationRadians != root.Transform.RotationRadians
            || targetTransform.Pivot != root.Transform.Pivot
            || targetTransform.FlipX != root.Transform.FlipX
            || targetTransform.FlipY != root.Transform.FlipY)
        {
            throw new ArgumentException("A rig translation may change only the root part position.", nameof(targetTransform));
        }

        var delta = targetTransform.Translation - root.Transform.Translation;
        var partIds = content.Parts.Select(part => TransformNodeId.From(part.Id.Value)).ToArray();
        var transforms = content.Parts.ToDictionary(part => TransformNodeId.From(part.Id.Value), part => part.Transform);
        var result = RigMovement.Translate(partIds, transforms, content.RigJoints,
            TransformNodeId.From(rootPartId.Value), delta);
        var parts = content.Parts.Select(part => part.WithTransform(result.Transforms[TransformNodeId.From(part.Id.Value)])).ToArray();
        return ModelDraftContent.Restore(
            content.SchemaVersion,
            content.ModelId,
            content.Revision,
            content.Slot,
            content.SourceAssetId,
            content.SourceWidth,
            content.SourceHeight,
            parts,
            content.LayerOrder,
            result.Joints);
    }
}
