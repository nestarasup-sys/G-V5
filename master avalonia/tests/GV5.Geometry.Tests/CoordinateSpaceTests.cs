using GV5.Geometry;
using Xunit;

namespace GV5.Geometry.Tests;

public sealed class CoordinateSpaceTests
{
    [Fact]
    public void ModelSceneViewConversionsRoundTripThroughTheirInverse()
    {
        var modelToScene = new SpaceTransform<ModelSpace, SceneSpace>(
            Matrix2D.CreateTranslation(100, -20) * Matrix2D.CreateScale(2, 3));
        var sceneToView = new SpaceTransform<SceneSpace, ViewSpace>(
            Matrix2D.CreateTranslation(15, 30) * Matrix2D.CreateScale(0.5, 0.25));
        var modelPoint = new SpatialPoint<ModelSpace>(new Point2D(12.5, -4));

        var modelToView = modelToScene.Then(sceneToView);
        var viewPoint = modelToView.Convert(modelPoint);
        var restoredModelPoint = modelToView.Invert().Convert(viewPoint);

        Assert.Equal(modelPoint.Value.X, restoredModelPoint.Value.X, 10);
        Assert.Equal(modelPoint.Value.Y, restoredModelPoint.Value.Y, 10);
        Assert.Equal(sceneToView.Convert(modelToScene.Convert(modelPoint)).Value, viewPoint.Value);
    }

    [Fact]
    public void DirectedConversionReturnsOnlyItsDestinationSpace()
    {
        var modelToScene = new SpaceTransform<ModelSpace, SceneSpace>(Matrix2D.CreateTranslation(3, 4));
        var scenePoint = modelToScene.Convert(new SpatialPoint<ModelSpace>(new Point2D(1, 2)));

        Assert.Equal(new Point2D(4, 6), scenePoint.Value);
    }

    [Fact]
    public void SingularMatrixCannotBeInverted()
    {
        var singular = new SpaceTransform<ModelSpace, SceneSpace>(Matrix2D.CreateScale(0, 1));

        Assert.Throws<InvalidOperationException>(() => singular.Invert());
    }
}
