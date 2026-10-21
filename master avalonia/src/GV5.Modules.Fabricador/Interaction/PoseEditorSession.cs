using System.Collections.Immutable;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;

namespace GV5.Modules.Fabricador.Interaction;

/// <summary>Transient pose editing operations over one immutable model publication.</summary>
public sealed class PoseEditorSession
{
    private readonly PublishedModelRevision _modelRevision;

    public PoseDraft Draft { get; private set; }
    public ModelPartId? SelectedPartId { get; private set; }
    public ModelDraftContent PreviewContent => Draft.ApplyToModelRevision(_modelRevision);

    public PoseEditorSession(PublishedModelRevision modelRevision, PoseDraft? draft = null)
    {
        _modelRevision = modelRevision ?? throw new ArgumentNullException(nameof(modelRevision));
        Draft = draft ?? PoseDraft.CreateFromModelRevision(modelRevision, "Nova pose");
        _ = Draft.ApplyToModelRevision(modelRevision);
    }

    public bool SelectPart(ModelPartId partId)
    {
        if (!Draft.PartTransforms.Any(item => item.PartId == partId))
        {
            throw new ArgumentException("The selected part is not part of the pinned model revision.", nameof(partId));
        }

        SelectedPartId = partId;
        return CanMoveSelectedPart;
    }

    public bool CanMoveSelectedPart
    {
        get
        {
            if (SelectedPartId is not { } selected) return false;
            var part = _modelRevision.Content.Parts.FirstOrDefault(item => item.Id == selected);
            if (part is null) return false;
            return !ContainsAny(part.Name, "tronco", "corpo", "cabeça", "cabeca");
        }
    }

    /// <summary>Moves the selected part and its transitively fixed descendants; source model data remains untouched.</summary>
    public void MoveSelected(Point2D delta)
    {
        var selected = RequireSelectedPart();
        if (!CanMoveSelectedPart)
        {
            throw new InvalidOperationException("The torso and head cannot be repositioned with the pose move tool.");
        }

        var nodes = Draft.PartTransforms.Select(item => TransformNodeId.From(item.PartId.Value)).ToArray();
        var transforms = Draft.PartTransforms.ToDictionary(item => TransformNodeId.From(item.PartId.Value), item => item.Transform);
        var anchorDelta = new Point2D(delta.X, -delta.Y);
        var result = RigMovement.Translate(nodes, transforms, Draft.RigJoints,
            TransformNodeId.From(selected.Value), delta, anchorDelta);
        var updated = Draft.PartTransforms.Select(item => PosePartTransform.Create(
            item.PartId,
            result.Transforms[TransformNodeId.From(item.PartId.Value)],
            item.IsVisible));
        Draft = Draft.WithContent(updated, result.Joints, Draft.LayerOrder, Draft.Category);
    }

    /// <summary>Rotates the selected bone around its joint anchor and optionally includes fixed descendants.</summary>
    public void RotateSelectedBy(double radians, bool includeFixedDescendants)
    {
        var selected = RequireSelectedPart();
        if (!double.IsFinite(radians)) throw new ArgumentOutOfRangeException(nameof(radians));
        if (radians == 0) return;

        var content = _modelRevision.Content;
        var rootNode = TransformNodeId.From(selected.Value);
        var origin = GetRotationOrigin(selected, content);
        var affected = GetRotationBranch(rootNode, Draft.RigJoints, includeFixedDescendants);
        var sourceParts = content.Parts.ToDictionary(part => part.Id);
        var updatedTransforms = new Dictionary<ModelPartId, Transform2D>();
        foreach (var item in Draft.PartTransforms)
        {
            if (!affected.Contains(TransformNodeId.From(item.PartId.Value)))
            {
                updatedTransforms[item.PartId] = item.Transform;
                continue;
            }

            var sourcePart = sourceParts[item.PartId];
            updatedTransforms[item.PartId] = RotatePartTransform(item.Transform, sourcePart.SourceCrop, origin, radians);
        }

        var updatedJoints = Draft.RigJoints.Select(joint => joint with
        {
            ParentAnchor = affected.Contains(joint.ParentPartId)
                ? RotateCanvasAnchor(joint.ParentAnchor, origin, radians, content.SourceHeight)
                : joint.ParentAnchor,
            ChildAnchor = affected.Contains(joint.ChildPartId)
                ? RotateCanvasAnchor(joint.ChildAnchor, origin, radians, content.SourceHeight)
                : joint.ChildAnchor
        }).ToArray();
        var updatedParts = Draft.PartTransforms.Select(item => PosePartTransform.Create(
            item.PartId,
            updatedTransforms[item.PartId],
            item.IsVisible));
        Draft = Draft.WithContent(updatedParts, updatedJoints, Draft.LayerOrder, Draft.Category);
    }

    private ModelPartId RequireSelectedPart() => SelectedPartId
        ?? throw new InvalidOperationException("Select a model part before editing its pose.");

    private Point2D GetRotationOrigin(ModelPartId selected, ModelDraftContent content)
    {
        var joint = Draft.RigJoints.FirstOrDefault(item =>
            item.ParentPartId == TransformNodeId.From(selected.Value)
            || item.ChildPartId == TransformNodeId.From(selected.Value));
        if (joint.Id.Value != Guid.Empty && content.SourceHeight is { } sourceHeight)
        {
            var anchor = joint.ParentPartId == TransformNodeId.From(selected.Value) ? joint.ParentAnchor : joint.ChildAnchor;
            return new Point2D(anchor.X, sourceHeight - anchor.Y);
        }

        var part = content.Parts.First(item => item.Id == selected);
        var current = Draft.PartTransforms.First(item => item.PartId == selected).Transform;
        return current.Apply(new Point2D(part.SourceCrop.Width / 2, part.SourceCrop.Height / 2));
    }

    private static Transform2D RotatePartTransform(Transform2D transform, Rect2D crop, Point2D origin, double radians)
    {
        var localCenter = new Point2D(crop.Width / 2, crop.Height / 2);
        var rotatedCenter = RotatePoint(transform.Apply(localCenter), origin, radians);
        var rotation = transform.RotationRadians + radians;
        var zeroTranslation = new Transform2D(Point2D.Zero, transform.Scale, rotation, transform.Pivot, transform.FlipX, transform.FlipY);
        var translation = rotatedCenter - zeroTranslation.Apply(localCenter);
        return new Transform2D(translation, transform.Scale, rotation, transform.Pivot, transform.FlipX, transform.FlipY);
    }

    private static ImmutableHashSet<TransformNodeId> GetRotationBranch(
        TransformNodeId root,
        IEnumerable<RigJoint> joints,
        bool includeFixedDescendants)
    {
        var affected = ImmutableHashSet.CreateBuilder<TransformNodeId>();
        affected.Add(root);
        if (!includeFixedDescendants) return affected.ToImmutable();

        var children = joints.Where(joint => joint.Mode == RigJointMode.Fixed)
            .GroupBy(joint => joint.ParentPartId)
            .ToDictionary(group => group.Key, group => group.Select(joint => joint.ChildPartId).ToArray());
        var pending = new Stack<TransformNodeId>();
        pending.Push(root);
        while (pending.TryPop(out var parent))
        {
            if (!children.TryGetValue(parent, out var descendants)) continue;
            foreach (var child in descendants)
            {
                if (affected.Add(child)) pending.Push(child);
            }
        }

        return affected.ToImmutable();
    }

    private static Point2D RotateCanvasAnchor(Point2D anchor, Point2D origin, double radians, int? sourceHeight)
    {
        var yUp = new Point2D(anchor.X, sourceHeight is { } height ? height - anchor.Y : -anchor.Y);
        var rotated = RotatePoint(yUp, origin, radians);
        return new Point2D(rotated.X, sourceHeight is { } targetHeight ? targetHeight - rotated.Y : -rotated.Y);
    }

    private static Point2D RotatePoint(Point2D point, Point2D origin, double radians)
    {
        var x = point.X - origin.X;
        var y = point.Y - origin.Y;
        var cosine = Math.Cos(radians);
        var sine = Math.Sin(radians);
        return new Point2D(origin.X + x * cosine - y * sine, origin.Y + x * sine + y * cosine);
    }

    private static bool ContainsAny(string value, params string[] terms) => terms.Any(term =>
        value.Contains(term, StringComparison.OrdinalIgnoreCase));
}
