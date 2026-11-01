using System;
using System.Drawing;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace WorkProof.WordNative
{
    /// <summary>Word only declares IDTExtensibility2/IRibbonExtensibility by vtable layout and COM identity.</summary>
    [ComVisible(true)]
    [Guid("B65AD801-ABAF-11D0-BB8B-00A0C90F2744")]
    [InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IDTExtensibility2
    {
        [DispId(1)] void OnConnection([MarshalAs(UnmanagedType.IDispatch)] object application, int connectMode, [MarshalAs(UnmanagedType.IDispatch)] object addInInstance, ref Array custom);
        [DispId(2)] void OnDisconnection(int removeMode, ref Array custom);
        [DispId(3)] void OnAddInsUpdate(ref Array custom);
        [DispId(4)] void OnStartupComplete(ref Array custom);
        [DispId(5)] void OnBeginShutdown(ref Array custom);
    }

    [ComVisible(true)]
    [Guid("000C0396-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IRibbonExtensibility
    {
        [DispId(1)] string GetCustomUI(string ribbonId);
    }

    /// <summary>
    /// Fixed identity: registry registration, the installer and the CI reflection check all use these values.
    /// The add-in owns no signing key and never reaches the collector's master token.
    /// </summary>
    [ComVisible(true)]
    [Guid("5F628C20-62BB-4DA6-94DF-36BD599A9301")]
    [ProgId("WorkProof.WordNative.Connect")]
    [ClassInterface(ClassInterfaceType.AutoDispatch)]
    public sealed class Connect : IDTExtensibility2, IRibbonExtensibility
    {
        private object word;
        private Recorder window;

        public void OnConnection(object application, int connectMode, object addInInstance, ref Array custom)
        {
            word = application;
        }

        public void OnDisconnection(int removeMode, ref Array custom)
        {
            CloseWindow();
            word = null;
        }

        public void OnAddInsUpdate(ref Array custom) { }
        public void OnStartupComplete(ref Array custom) { }
        public void OnBeginShutdown(ref Array custom) { CloseWindow(); }

        /// <summary>Word asks with "Microsoft.Word.Document"; the add-in is only registered for Word.</summary>
        public string GetCustomUI(string ribbonId) { return RibbonMarkup.Value; }

        /// <summary>Called by the ribbon's onLoad; kept so a future reload can invalidate controls.</summary>
        public void RibbonLoad(object ribbonUi) { }

        public object GetRibbonImage(object control)
        {
            try
            {
                using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("WorkProof.WordNative.ribbon-32.png"))
                {
                    if (stream == null) return null;
                    using (var image = Image.FromStream(stream)) return PictureConverter.ToPictureDisp(image);
                }
            }
            catch (Exception)
            {
                // A missing picture must never keep the tab from loading.
                return null;
            }
        }

        public void OpenRecorder(object control)
        {
            try
            {
                if (word == null) { Inform("Word 还没有完成加载。请保存文档后重新打开 Word 再试。"); return; }
                if (window == null || window.IsDisposed) window = new Recorder(word);
                window.Show();
                if (window.WindowState == FormWindowState.Minimized) window.WindowState = FormWindowState.Normal;
                window.Activate();
            }
            catch (Exception)
            {
                Inform("无法打开记录窗口。请重新打开 Word 后重试；已有文档不会受影响。");
            }
        }

        private void CloseWindow()
        {
            try
            {
                if (window != null && !window.IsDisposed) window.Close();
            }
            catch (Exception) { }
            window = null;
        }

        private static void Inform(string text)
        {
            MessageBox.Show(text, "WorkProof", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }

    internal static class RibbonMarkup
    {
        // getImage keeps the official artwork; every callback reaches this class through COM dispatch.
        public const string Value =
            "<customUI xmlns='http://schemas.microsoft.com/office/2009/07/customui' onLoad='RibbonLoad'>" +
            "<ribbon><tabs><tab id='workproofTab' label='WorkProof'>" +
            "<group id='workproofGroup' label='创作过程记录'>" +
            "<button id='workproofOpen' label='打开创作记录' size='large' getImage='GetRibbonImage' onAction='OpenRecorder'" +
            " screentip='记录这份文档的创作过程'" +
            " supertip='只保存编辑数量与摘要，不发送正文。导出后得到匹配的作品和 .wproof 证书；采样可能合并或遗漏修改。'/>" +
            "</group></tab></tabs></ribbon></customUI>";
    }

    /// <summary>AxHost is the only framework-provided way to build an IPictureDisp without Office PIAs.</summary>
    internal sealed class PictureConverter : AxHost
    {
        private PictureConverter() : base("00000000-0000-0000-0000-000000000000") { }

        public static object ToPictureDisp(Image image)
        {
            return GetIPictureDispFromPicture(image);
        }
    }
}
