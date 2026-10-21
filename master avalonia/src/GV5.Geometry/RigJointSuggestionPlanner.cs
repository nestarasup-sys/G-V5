namespace GV5.Geometry;

/// <summary>Geometry used to suggest a parent-child rig connection for one model part.</summary>
public sealed record RigPartGeometry
{
    public TransformNodeId Id { get; }
    public string Name { get; }
    public Rect2D Bounds { get; }

    public RigPartGeometry(TransformNodeId id, string name, Rect2D bounds)
    {
        if (id.Value == Guid.Empty)
            throw new ArgumentException("A rig suggestion part requires a valid ID.", nameof(id));
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        if (bounds.Width <= 0 || bounds.Height <= 0)
            throw new ArgumentOutOfRangeException(nameof(bounds), "Rig suggestion parts require non-empty bounds.");

        Id = id;
        Name = name.Trim();
        Bounds = bounds;
    }
}

/// <summary>
/// Proposes a safe rig forest from part names and positions. Every emitted joint is explicitly marked
/// as a suggestion so the editor can review or change it before publication.
/// </summary>
public static class RigJointSuggestionPlanner
{
    public static IReadOnlyList<RigJoint> Suggest(IEnumerable<RigPartGeometry> parts)
    {
        ArgumentNullException.ThrowIfNull(parts);
        var orderedParts = parts.ToArray();
        if (orderedParts.Select(part => part.Id).Distinct().Count() != orderedParts.Length)
            throw new ArgumentException("Rig suggestion parts must have unique IDs.", nameof(parts));
        if (orderedParts.Length < 2)
            return [];

        var sheetLeft = orderedParts.Min(part => part.Bounds.Left);
        var sheetRight = orderedParts.Max(part => part.Bounds.Right);
        var sheetTop = orderedParts.Min(part => part.Bounds.Top);
        var sheetBottom = orderedParts.Max(part => part.Bounds.Bottom);
        var sheetWidth = Math.Max(1, sheetRight - sheetLeft);
        var sheetHeight = Math.Max(1, sheetBottom - sheetTop);
        var sheetCenterX = (sheetLeft + sheetRight) / 2;

        var torso = orderedParts.FirstOrDefault(part => ContainsAny(part.Name, "tronco", "corpo"))
            ?? orderedParts
                .Select((part, index) => (Part: part, Index: index,
                    Score: BodyScore(part, sheetCenterX, sheetTop, sheetHeight, sheetWidth)))
                .OrderBy(item => item.Score)
                .ThenBy(item => item.Index)
                .First().Part;

        var torsoCenter = Center(torso.Bounds);
        var torsoBottom = torso.Bounds.Bottom;
        var head = orderedParts.FirstOrDefault(part => part.Id != torso.Id && ContainsAny(part.Name, "cabeça", "cabeca"))
            ?? orderedParts
                .Where(part => part.Id != torso.Id && Center(part.Bounds).Y < torsoCenter.Y)
                .OrderBy(part => Math.Abs(Center(part.Bounds).X - torsoCenter.X))
                .ThenBy(part => Array.IndexOf(orderedParts, part))
                .FirstOrDefault();

        var suggestions = new List<RigJoint>(orderedParts.Length - 1);
        var connected = new HashSet<TransformNodeId> { torso.Id };
        var parented = new HashSet<TransformNodeId>();

        Add(torso, head);

        var excludes = new HashSet<TransformNodeId> { torso.Id };
        if (head is not null) excludes.Add(head.Id);
        var limbThreshold = Math.Max(torso.Bounds.Width * 0.35, sheetWidth * 0.035);
        var limbs = orderedParts.Where(part => !excludes.Contains(part.Id)
            && Math.Abs(Center(part.Bounds).X - torsoCenter.X) > limbThreshold).ToArray();

        foreach (var isLeft in new[] { true, false })
        {
            var onSide = limbs.Where(part => isLeft
                ? Center(part.Bounds).X < torsoCenter.X
                : Center(part.Bounds).X >= torsoCenter.X).ToArray();
            var armSegments = onSide.Where(part => Center(part.Bounds).Y < torsoBottom + sheetHeight * 0.015)
                .OrderBy(part => Center(part.Bounds).Y)
                .ThenBy(part => Array.IndexOf(orderedParts, part))
                .ToArray();
            var legSegments = onSide.Where(part => Center(part.Bounds).Y >= torsoBottom + sheetHeight * 0.015)
                .OrderBy(part => Center(part.Bounds).Y)
                .ThenBy(part => Array.IndexOf(orderedParts, part))
                .ToArray();

            Add(torso, armSegments.FirstOrDefault());
            for (var index = 1; index < armSegments.Length; index++)
                Add(armSegments[index - 1], armSegments[index]);

            Add(torso, legSegments.FirstOrDefault());
            for (var index = 1; index < legSegments.Length; index++)
                Add(legSegments[index - 1], legSegments[index]);
        }

        while (connected.Count < orderedParts.Length)
        {
            (RigPartGeometry Parent, RigPartGeometry Child, double Distance)? nearest = null;
            foreach (var parent in orderedParts.Where(part => connected.Contains(part.Id)))
            foreach (var child in orderedParts.Where(part => !connected.Contains(part.Id) && !parented.Contains(part.Id)))
            {
                var parentCenter = Center(parent.Bounds);
                var childCenter = Center(child.Bounds);
                var normalizedX = (childCenter.X - parentCenter.X) / sheetWidth;
                var normalizedY = (childCenter.Y - parentCenter.Y) / sheetHeight;
                var distance = Math.Sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
                if (nearest is null || distance < nearest.Value.Distance)
                    nearest = (parent, child, distance);
            }

            if (nearest is null) break;
            Add(nearest.Value.Parent, nearest.Value.Child);
        }

        return suggestions.AsReadOnly();

        void Add(RigPartGeometry? parent, RigPartGeometry? child)
        {
            if (parent is null || child is null || parent.Id == child.Id || parented.Contains(child.Id))
                return;

            var parentAnchor = EdgePoint(parent.Bounds, child.Bounds);
            var childAnchor = EdgePoint(child.Bounds, parent.Bounds);
            suggestions.Add(new RigJoint(
                RigJointId.New(), parent.Id, child.Id, parentAnchor, childAnchor,
                RigJointMode.Loose, IsSuggested: true));
            parented.Add(child.Id);
            connected.Add(child.Id);
        }
    }

    private static double BodyScore(RigPartGeometry part, double sheetCenterX = 0, double sheetTop = 0, double sheetHeight = 1, double sheetWidth = 1)
    {
        var center = Center(part.Bounds);
        var areaPenalty = part.Bounds.Width * part.Bounds.Height / (sheetWidth * sheetHeight);
        var normalizedX = (center.X - sheetCenterX) / sheetWidth;
        var normalizedY = (center.Y - (sheetTop + sheetHeight * 0.38)) / sheetHeight;
        return Math.Sqrt(normalizedX * normalizedX + normalizedY * normalizedY) - areaPenalty * 0.4;
    }

    private static bool ContainsAny(string value, params string[] fragments) =>
        fragments.Any(fragment => value.Contains(fragment, StringComparison.OrdinalIgnoreCase));

    private static Point2D Center(Rect2D bounds) =>
        new(bounds.X + bounds.Width / 2, bounds.Y + bounds.Height / 2);

    private static Point2D EdgePoint(Rect2D part, Rect2D target)
    {
        var origin = Center(part);
        var destination = Center(target);
        var dx = destination.X - origin.X;
        var dy = destination.Y - origin.Y;
        var horizontal = Math.Abs(dx / Math.Max(1, part.Width)) > Math.Abs(dy / Math.Max(1, part.Height));
        return horizontal
            ? new Point2D(origin.X + Math.Sign(dx == 0 ? 1 : dx) * part.Width / 2,
                origin.Y + dy * part.Width / (2 * Math.Max(1, Math.Abs(dx))))
            : new Point2D(origin.X + dx * part.Height / (2 * Math.Max(1, Math.Abs(dy))),
                origin.Y + Math.Sign(dy == 0 ? 1 : dy) * part.Height / 2);
    }
}
