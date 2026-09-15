using System.IO.Compression;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using NiftyTimer.Update;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// The update download itself, against a fake server that controls how fast the body arrives.
///
/// The defect, found on the first real update (0.1.0 → 0.2.0): the installer fetched the ~63 MB zip
/// with a plain <c>GetAsync</c>, which reads the whole body inside the app's 30-second HTTP timeout.
/// On any connection slower than about 17 Mbit/s the download was cancelled at the 30-second mark
/// and the person saw "Update failed. You're still on the current version." every time.
///
/// Unsigned archives on both sides, so the publisher check passes and the whole of
/// <see cref="UpdateInstaller.StageAsync"/> runs for real.
/// </summary>
public class UpdateDownloadTests
{
    private static (byte[] Zip, string Sha256) Archive()
    {
        using var memory = new MemoryStream();
        using (var zip = new ZipArchive(memory, ZipArchiveMode.Create, leaveOpen: true))
        {
            var entry = zip.CreateEntry("NiftyTimer.exe", CompressionLevel.NoCompression);
            using var stream = entry.Open();
            var payload = new byte[256 * 1024];
            new Random(7).NextBytes(payload);
            stream.Write(payload);
        }

        var bytes = memory.ToArray();
        return (bytes, Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant());
    }

    private static ReleaseManifest Manifest(string sha256) =>
        new(
            AppVersion.Parse("0.2.1"),
            DateTimeOffset.UtcNow,
            new Uri("https://example.invalid/NiftyTimer-windows-pilot.zip"),
            sha256);

    private static UpdateInstaller Installer(Func<Stream> body, TimeSpan clientTimeout, TimeSpan stallTimeout)
    {
        var install = Path.Combine(Path.GetTempPath(), "niftytimer-tests", Guid.NewGuid().ToString("n"), "install");
        Directory.CreateDirectory(install);
        var running = Path.Combine(install, "NiftyTimer.exe");
        File.WriteAllBytes(running, [0x4D, 0x5A]);

        var http = new HttpClient(new BodyHandler(body)) { Timeout = clientTimeout };
        return new UpdateInstaller(http, install, running, stallTimeout);
    }

    /// <summary>
    /// Sixteen chunks 120 ms apart: about two seconds in all — four times the client's timeout —
    /// but never quiet for long. The old buffered download is cancelled at 500 ms and fails this.
    /// </summary>
    [Fact(Timeout = 30000)]
    public async Task ADownloadSlowerThanTheClientTimeoutStillCompletes()
    {
        var (zip, sha256) = Archive();
        var installer = Installer(
            () => new TricklingStream(zip, (zip.Length / 16) + 1, TimeSpan.FromMilliseconds(120)),
            clientTimeout: TimeSpan.FromMilliseconds(500),
            stallTimeout: TimeSpan.FromSeconds(5));

        var staged = await installer.StageAsync(Manifest(sha256));

        Assert.True(File.Exists(Path.Combine(staged, "NiftyTimer.exe")), "The slow download never reached staging.");
    }

    /// <summary>A connection that stops sending must fail the update, not hang it forever.</summary>
    [Fact(Timeout = 30000)]
    public async Task ADownloadThatGoesQuietFailsInsteadOfHanging()
    {
        var (zip, sha256) = Archive();
        var installer = Installer(
            () => new TricklingStream(zip, (zip.Length / 16) + 1, TimeSpan.FromMilliseconds(10), silentAfterChunks: 2),
            clientTimeout: Timeout.InfiniteTimeSpan,
            stallTimeout: TimeSpan.FromMilliseconds(500));

        var failure = await Assert.ThrowsAsync<UpdateInstallException>(() => installer.StageAsync(Manifest(sha256)));

        Assert.Equal(UpdateInstallFailure.Download, failure.Failure);
    }

    private sealed class BodyHandler(Func<Stream> body) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(body()) });
    }

    /// <summary>Hands the body over a chunk at a time with a pause before each; optionally goes silent.</summary>
    private sealed class TricklingStream(byte[] body, int chunk, TimeSpan pause, int silentAfterChunks = int.MaxValue) : Stream
    {
        private int _position;
        private int _chunksSent;

        public override bool CanRead => true;

        public override bool CanSeek => false;

        public override bool CanWrite => false;

        public override long Length => throw new NotSupportedException();

        public override long Position
        {
            get => throw new NotSupportedException();
            set => throw new NotSupportedException();
        }

        public override void Flush()
        {
        }

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        public override int Read(byte[] buffer, int offset, int count) =>
            ReadAsync(buffer.AsMemory(offset, count)).AsTask().GetAwaiter().GetResult();

        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
            ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            if (_position >= body.Length)
            {
                return 0;
            }

            if (_chunksSent >= silentAfterChunks)
            {
                await Task.Delay(Timeout.Infinite, cancellationToken);
            }

            await Task.Delay(pause, cancellationToken);
            var count = Math.Min(Math.Min(chunk, buffer.Length), body.Length - _position);
            body.AsMemory(_position, count).CopyTo(buffer);
            _position += count;
            _chunksSent++;
            return count;
        }
    }
}
