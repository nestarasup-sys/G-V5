namespace GV5.Geometry;

internal static class GeometryValue
{
    public static void RequireFinite(double value, string parameterName)
    {
        if (!double.IsFinite(value))
        {
            throw new ArgumentOutOfRangeException(parameterName, value, "Geometry values must be finite numbers.");
        }
    }
}
