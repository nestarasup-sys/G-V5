using System.Diagnostics;
using System.Runtime.InteropServices;
using GV5.Geometry;

Console.WriteLine($"Runtime={RuntimeInformation.FrameworkDescription}; OS={RuntimeInformation.OSDescription}; Arch={RuntimeInformation.ProcessArchitecture}");
Console.WriteLine("parts;iterations;median_ms;ops_per_second;managed_bytes_per_eval");

foreach (var count in new[] { 10, 100, 1000 })
{
    var ids = Enumerable.Range(0, count).Select(_ => TransformNodeId.New()).ToArray();
    var joints = ids.Skip(1).Select((id, index) => new RigJoint(
        RigJointId.New(), ids[index], id, new Point2D(4, 0), new Point2D(1, 0)));
    var skeleton = RigSkeleton.Create(ids, joints);
    var pose = ids.ToDictionary(
        id => id,
        _ => new Transform2D(new Point2D(0.25, -0.125), new Point2D(1.01, 0.99), 0.001, Point2D.Zero));
    var iterations = count switch { 10 => 500, 100 => 200, _ => 50 };

    for (var warmup = 0; warmup < 3; warmup++)
    {
        _ = skeleton.EvaluateWorldMatrices(pose);
    }

    var samples = new double[7];
    long allocatedBytes = 0;
    for (var sample = 0; sample < samples.Length; sample++)
    {
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        var beforeBytes = GC.GetAllocatedBytesForCurrentThread();
        var timer = Stopwatch.StartNew();
        for (var iteration = 0; iteration < iterations; iteration++)
        {
            _ = skeleton.EvaluateWorldMatrices(pose);
        }
        timer.Stop();
        samples[sample] = timer.Elapsed.TotalMilliseconds / iterations;
        allocatedBytes = GC.GetAllocatedBytesForCurrentThread() - beforeBytes;
    }

    Array.Sort(samples);
    var medianMs = samples[samples.Length / 2];
    var opsPerSecond = medianMs <= 0 ? double.PositiveInfinity : 1000 / medianMs;
    var bytesPerEvaluation = allocatedBytes / (double)iterations;
    Console.WriteLine($"{count};{iterations};{medianMs:F4};{opsPerSecond:F0};{bytesPerEvaluation:F0}");
}
