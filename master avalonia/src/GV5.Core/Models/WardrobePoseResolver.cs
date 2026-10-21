using System.Collections.Immutable;
using GV5.Core.Identity;
using GV5.Geometry;

namespace GV5.Core.Models;

/// <summary>A garment asset and its resolved placement in one exact pose.</summary>
public sealed record WardrobeComponentPosePlacement(
    WardrobeComponentId ComponentId,
    AssetId AssetId,
    WardrobeCategory Category,
    WardrobePlacement Placement);

/// <summary>Projects wardrobe bindings onto pose transforms without mutating the wardrobe or pose snapshots.</summary>
public static class WardrobePoseResolver
{
    public static ImmutableArray<WardrobeComponentPosePlacement> Resolve(WardrobeSet wardrobe,
        PublishedModelRevision model, PoseDraft pose)
    {
        ArgumentNullException.ThrowIfNull(wardrobe);
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(pose);
        var modelReference = ModelRevisionReference.From(model);
        if (wardrobe.Model != modelReference || pose.Model != modelReference)
            throw new ArgumentException("Wardrobe and pose must reference the exact same model publication.");

        var sourceParts = model.Content.Parts.ToDictionary(part => part.Id);
        var poseTransforms = pose.PartTransforms.ToDictionary(part => part.PartId);
        var resolved = ImmutableArray.CreateBuilder<WardrobeComponentPosePlacement>(wardrobe.Components.Length);
        foreach (var component in wardrobe.Components)
        {
            if (!sourceParts.TryGetValue(component.BoneId, out var sourcePart))
                throw new InvalidDataException("A wardrobe component refers to a bone missing from its pinned model revision.");
            if (!poseTransforms.TryGetValue(component.BoneId, out var posePart))
                throw new InvalidDataException("The pose does not contain a transform for a wardrobe component's bone.");
            if (!string.Equals(component.Binding.BoneId, component.BoneId.ToString(), StringComparison.Ordinal))
                throw new InvalidDataException("A wardrobe binding is connected to a different bone.");

            var sourceFrame = WardrobeBoneFrame.FromTransform(sourcePart.Id.ToString(),
                sourcePart.SourceTransform.Crop, sourcePart.SourceTransform.Transform);
            if (Math.Abs(component.Binding.BoneWidth - sourceFrame.Bounds.Width) > 0.000001
                || Math.Abs(component.Binding.BoneHeight - sourceFrame.Bounds.Height) > 0.000001
                || Math.Abs(component.Binding.BoneRotationDegrees - sourceFrame.RotationDegrees) > 0.000001)
                throw new InvalidDataException("A wardrobe binding was captured against different source-bone geometry.");

            var poseFrame = WardrobeBoneFrame.FromTransform(posePart.PartId.ToString(),
                sourcePart.SourceTransform.Crop, posePart.Transform);
            resolved.Add(new WardrobeComponentPosePlacement(component.Id, component.AssetId, component.Category,
                WardrobeBindingMath.Resolve(component.Binding, poseFrame)));
        }
        return resolved.MoveToImmutable();
    }
}
