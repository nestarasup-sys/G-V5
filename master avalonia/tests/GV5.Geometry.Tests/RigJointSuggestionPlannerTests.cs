using GV5.Geometry;
using Xunit;

namespace GV5.Geometry.Tests;

public sealed class RigJointSuggestionPlannerTests
{
    [Fact]
    public void Suggest_UsesNamedBodyAndBuildsPositionOrderedLimbChains()
    {
        var torso = Part("Corpo", 40, 35, 20, 40);
        var head = Part("Cabeça", 44, 5, 12, 20);
        var upperArm = Part("Peça sem nome", 22, 40, 10, 20);
        var forearm = Part("Outra peça", 10, 55, 10, 20);
        var thigh = Part("Perna", 34, 78, 10, 22);
        var lowerLeg = Part("Pé", 28, 98, 9, 20);

        var joints = RigJointSuggestionPlanner.Suggest([torso, head, upperArm, forearm, thigh, lowerLeg]);

        Assert.Collection(joints,
            joint => AssertPair(joint, torso, head),
            joint => AssertPair(joint, torso, upperArm),
            joint => AssertPair(joint, upperArm, forearm),
            joint => AssertPair(joint, torso, thigh),
            joint => AssertPair(joint, thigh, lowerLeg));
        Assert.All(joints, joint =>
        {
            Assert.True(joint.IsSuggested);
            Assert.Equal(RigJointMode.Loose, joint.Mode);
        });
        Assert.All(joints, joint =>
        {
            var parent = GetPart(joint.ParentPartId, torso, head, upperArm, forearm, thigh, lowerLeg);
            var child = GetPart(joint.ChildPartId, torso, head, upperArm, forearm, thigh, lowerLeg);
            AssertBoundaryPoint(parent.Bounds, joint.ParentAnchor);
            AssertBoundaryPoint(child.Bounds, joint.ChildAnchor);
        });
        _ = RigSkeleton.Create([torso.Id, head.Id, upperArm.Id, forearm.Id, thigh.Id, lowerLeg.Id], joints);
    }

    [Fact]
    public void Suggest_FallsBackToPositionAndConnectsUnclassifiedPartsWithoutDuplicateParents()
    {
        var parts = new[]
        {
            Part("Parte A", 42, 32, 18, 42),
            Part("Parte B", 44, 4, 14, 20),
            Part("Parte C", 12, 45, 10, 18),
            Part("Parte D", 70, 50, 12, 15),
            Part("Acessório", 90, 80, 8, 10)
        };

        var joints = RigJointSuggestionPlanner.Suggest(parts);
        var graph = RigSkeleton.Create(parts.Select(part => part.Id), joints);

        Assert.Equal(parts.Length - 1, joints.Count);
        Assert.Equal(joints.Count, joints.Select(joint => joint.ChildPartId).Distinct().Count());
        Assert.All(joints, joint => Assert.True(joint.IsSuggested));
        Assert.Equal(parts.Length, graph.EvaluateWorldMatrices(parts.ToDictionary(
            part => part.Id,
            _ => Transform2D.Identity)).Count);
    }

    [Fact]
    public void Suggest_ReturnsEmptyForFewerThanTwoPartsAndRejectsInvalidInput()
    {
        var only = Part("Corpo", 0, 0, 10, 20);
        Assert.Empty(RigJointSuggestionPlanner.Suggest([]));
        Assert.Empty(RigJointSuggestionPlanner.Suggest([only]));

        Assert.Throws<ArgumentException>(() => RigJointSuggestionPlanner.Suggest([only, only]));
        Assert.Throws<ArgumentOutOfRangeException>(() => new RigPartGeometry(
            TransformNodeId.New(), "Vazia", new Rect2D(0, 0, 0, 10)));
    }

    private static RigPartGeometry Part(string name, double x, double y, double width, double height) =>
        new(TransformNodeId.New(), name, new Rect2D(x, y, width, height));

    private static void AssertPair(RigJoint joint, RigPartGeometry parent, RigPartGeometry child)
    {
        Assert.Equal(parent.Id, joint.ParentPartId);
        Assert.Equal(child.Id, joint.ChildPartId);
    }

    private static RigPartGeometry GetPart(TransformNodeId id, params RigPartGeometry[] parts) =>
        Assert.Single(parts, part => part.Id == id);

    private static void AssertBoundaryPoint(Rect2D bounds, Point2D point)
    {
        Assert.InRange(point.X, bounds.Left, bounds.Right);
        Assert.InRange(point.Y, bounds.Top, bounds.Bottom);
        Assert.True(point.X == bounds.Left || point.X == bounds.Right
            || point.Y == bounds.Top || point.Y == bounds.Bottom);
    }
}
