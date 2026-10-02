using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Data;
using System.Drawing;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace FirstSolution
{
    public partial class Form1 : Form
    {
        public Form1()
        {
            InitializeComponent();
        }

       

        private void Form1_Load(object sender, EventArgs e)
        {
            UpdateCount();
        }

        private void btnAdd_Click(object sender, EventArgs e)
        {
            AddItem();
        }

        private void textBox1_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Enter)
            {
                e.SuppressKeyPress = true;
                AddItem();
            }
        }

        private void btnDelete_Click(object sender, EventArgs e)
        {
            foreach (ListViewItem item in listView1.SelectedItems.Cast<ListViewItem>().ToList())
            {
                listView1.Items.Remove(item);
            }
            UpdateCount();
        }

        private void AddItem()
        {
            string text = textBox1.Text.Trim();
            if (text.Length == 0)
            {
                return;
            }

            listView1.Items.Add(text);
            textBox1.Clear();
            textBox1.Focus();
            UpdateCount();
        }

        private void UpdateCount()
        {
            label1.Text = "Items: " + listView1.Items.Count;
        }
    }
}
