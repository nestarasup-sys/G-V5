using GV5.Geometry;

namespace GV5.Core.Models;

/// <summary>Deterministically samples an animation and composes a preview from its pinned model snapshot.</summary>
public static class AnimationEvaluator
{
    public static ModelDraftContent Evaluate(AnimationDraft animation, PublishedModelRevision modelRevision, double elapsedMilliseconds)
    {
        ArgumentNullException.ThrowIfNull(animation);
        ArgumentNullException.ThrowIfNull(modelRevision);
        if (!double.IsFinite(elapsedMilliseconds) || elapsedMilliseconds < 0)
            throw new ArgumentOutOfRangeException(nameof(elapsedMilliseconds));
        if (animation.Frames.IsDefaultOrEmpty) throw new ArgumentException("The animation has no frames.", nameof(animation));

        var frames = animation.Frames;
        var index = 0;
        var nextIndex = 0;
        var localTime = 0d;
        var segmentDuration = 1d;
        if (animation.LoopMode == AnimationLoopMode.PingPong && frames.Length > 1)
        {
            var forwardDuration = frames.Take(frames.Length - 1).Sum(frame => (double)frame.DurationMs);
            var reverseDuration = frames.Skip(1).Sum(frame => (double)frame.DurationMs);
            var cycleDuration = forwardDuration + reverseDuration;
            var phase = elapsedMilliseconds % cycleDuration;
            if (phase < forwardDuration)
            {
                localTime = phase;
                while (index < frames.Length - 1 && localTime >= frames[index].DurationMs)
                {
                    localTime -= frames[index].DurationMs;
                    index++;
                }
                nextIndex = Math.Min(index + 1, frames.Length - 1);
            }
            else
            {
                localTime = phase - forwardDuration;
                index = frames.Length - 1;
                while (index > 0 && localTime >= frames[index].DurationMs)
                {
                    localTime -= frames[index].DurationMs;
                    index--;
                }
                nextIndex = Math.Max(0, index - 1);
            }
            segmentDuration = frames[index].DurationMs;
        }
        else
        {
            var time = animation.LoopMode == AnimationLoopMode.Loop
                ? elapsedMilliseconds % animation.DurationMs
                : Math.Min(elapsedMilliseconds, animation.DurationMs);
            while (index < frames.Length - 1 && time >= frames[index].DurationMs)
            {
                time -= frames[index].DurationMs;
                index++;
            }
            localTime = time;
            nextIndex = index == frames.Length - 1
                ? animation.LoopMode == AnimationLoopMode.Loop ? 0 : index
                : index + 1;
            segmentDuration = frames[index].DurationMs;
        }

        var from = frames[index];
        var to = frames[nextIndex];
        var progress = animation.Easing == AnimationEasing.Step || from == to
            ? 0
            : Math.Clamp(localTime / segmentDuration, 0, 1);
        progress = animation.Easing switch
        {
            AnimationEasing.Smooth => progress * progress * (3 - 2 * progress),
            _ => progress
        };

        var toKeys = to.Keys.ToDictionary(key => key.PartId);
        var keys = from.Keys.Select(key =>
        {
            var next = toKeys[key.PartId];
            return AnimationPartKey.Create(key.PartId, Interpolate(key.Transform, next.Transform, progress),
                progress < 0.5 ? key.IsVisible : next.IsVisible);
        }).ToArray();
        var toJoints = to.RigJoints.ToDictionary(joint => joint.Id);
        var joints = from.RigJoints.Select(joint =>
        {
            var next = toJoints[joint.Id];
            return joint with
            {
                ParentAnchor = Lerp(joint.ParentAnchor, next.ParentAnchor, progress),
                ChildAnchor = Lerp(joint.ChildAnchor, next.ChildAnchor, progress),
                Mode = progress < 0.5 ? joint.Mode : next.Mode,
                IsSuggested = progress < 0.5 ? joint.IsSuggested : next.IsSuggested
            };
        }).ToArray();

        return animation.ApplySnapshotToModelRevision(modelRevision, keys, joints);
    }

    private static Transform2D Interpolate(Transform2D from, Transform2D to, double t) => new(
        Lerp(from.Translation, to.Translation, t),
        Lerp(from.Scale, to.Scale, t),
        from.RotationRadians + ShortestAngle(from.RotationRadians, to.RotationRadians) * t,
        Lerp(from.Pivot, to.Pivot, t),
        t < 0.5 ? from.FlipX : to.FlipX,
        t < 0.5 ? from.FlipY : to.FlipY);

    private static double ShortestAngle(double from, double to) => (to - from + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    private static Point2D Lerp(Point2D from, Point2D to, double t) => new(from.X + (to.X - from.X) * t, from.Y + (to.Y - from.Y) * t);
}
